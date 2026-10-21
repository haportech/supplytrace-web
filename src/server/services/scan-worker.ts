import type { GitHubClient } from '../clients/github'
import { UpstreamError } from '../clients/http'
import type { KevCatalog, KevClient } from '../clients/kev'
import { matchKev } from '../clients/kev'
import type { OsvClient } from '../clients/osv'
import type {
  NewFinding,
  NewPackage,
  ScanRepository,
} from '../db/scan-repository'
import { parseRepositoryUrl, RepositoryUrlError } from '../domain/repository-url'
import { calculateRisk } from '../domain/risk'
import {
  MAX_FINDINGS_PER_SCAN,
  OSV_PACKAGES_PER_CHUNK,
  type ScanQueueMessage,
  type ScanQueueSender,
} from './queue-message'

const MAX_ATTEMPTS = 3
const PACKAGE_LIMIT_WARNING =
  'Some package versions were unclear, so they were not checked.'
const FINDING_LIMIT_WARNING =
  `More than ${MAX_FINDINGS_PER_SCAN} problems were found. Only the first ${MAX_FINDINGS_PER_SCAN} are shown.`
const CISA_WARNING =
  'One safety list was not available, so this result may be missing details.'

export type ScanWorkerDependencies = {
  scans: Pick<
    ScanRepository,
    | 'get'
    | 'updateStatus'
    | 'replaceInventory'
    | 'ensureChunks'
    | 'getPackagesByIds'
    | 'claimChunk'
    | 'failChunk'
    | 'completeChunk'
    | 'upsertFindings'
    | 'appendPartialReason'
    | 'getResult'
    | 'complete'
    | 'fail'
  >
  github: Pick<GitHubClient, 'loadSbom'>
  osv: Pick<OsvClient, 'checkPackages'>
  kev: Pick<KevClient, 'load'>
  queue: ScanQueueSender
  maxFindings: number | null
  cache: Cache | undefined
  now: () => Date
}

export type QueueDecision =
  | { action: 'ack' }
  | { action: 'retry'; delaySeconds: number }

function mergeReasons(...values: Array<string | null | undefined>): string | null {
  let merged = ''

  for (const value of values) {
    const reason = value?.trim() ?? ''
    if (reason.length === 0 || merged.includes(reason)) continue
    merged = merged.length > 0 ? `${merged} ${reason}` : reason
  }

  return merged || null
}

function isFinished(status: string): boolean {
  return status === 'complete' || status === 'partial' || status === 'failed'
}

function retryable(error: unknown): boolean {
  if (error instanceof RepositoryUrlError) return false
  if (!(error instanceof UpstreamError)) return true
  return !(
    error.code.endsWith('_NOT_FOUND') ||
    error.code.endsWith('_RESPONSE_TOO_LARGE') ||
    error.code.endsWith('_RATE_LIMITED')
  )
}

function publicFailure(error: unknown): { code: string; message: string } {
  if (error instanceof UpstreamError || error instanceof RepositoryUrlError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'SCAN_FAILED',
    message: 'We could not finish the check. Try again in a few minutes.',
  }
}

export class ScanWorker {
  constructor(private readonly dependencies: ScanWorkerDependencies) {}

  async process(message: ScanQueueMessage, attempts: number): Promise<QueueDecision> {
    const scan = await this.dependencies.scans.get(message.scanId)
    if (!scan || isFinished(scan.status)) return { action: 'ack' }
    if (
      message.type === 'FETCH_SBOM' &&
      scan.status === 'checking' &&
      attempts <= 1
    ) {
      return { action: 'ack' }
    }

    try {
      if (message.type === 'FETCH_SBOM') {
        await this.fetchSbom(message)
      } else {
        await this.checkOsv(message, attempts)
      }
      return { action: 'ack' }
    } catch (error) {
      const now = this.dependencies.now().toISOString()
      if (message.type === 'CHECK_OSV') {
        await this.dependencies.scans.failChunk(
          message.scanId,
          message.chunkIndex,
          now,
        )
      }

      if (attempts < MAX_ATTEMPTS && retryable(error)) {
        return {
          action: 'retry',
          delaySeconds: Math.min(60, 2 ** (attempts + 1)),
        }
      }

      const failure = publicFailure(error)
      await this.dependencies.scans.fail(
        message.scanId,
        failure.code,
        failure.message,
        now,
      )
      return { action: 'ack' }
    }
  }

  private async fetchSbom(
    message: Extract<ScanQueueMessage, { type: 'FETCH_SBOM' }>,
  ): Promise<void> {
    const now = this.dependencies.now().toISOString()
    const repository = parseRepositoryUrl(message.repositoryUrl)
    await this.dependencies.scans.updateStatus(
      message.scanId,
      'fetching',
      'Reading the package list from GitHub.',
      now,
    )
    const sbom = await this.dependencies.github.loadSbom(repository)
    const packages: NewPackage[] = sbom.packages.map((item, index) => ({
      id: `${message.scanId}:package:${index}`,
      spdxId: item.spdxId,
      name: item.name,
      version: item.version,
      ecosystem: item.ecosystem,
      purl: item.purl,
      direct: item.direct,
    }))
    await this.dependencies.scans.replaceInventory(
      message.scanId,
      packages,
      sbom.edges,
      {
        partial: sbom.partial,
        partialReason: sbom.partialReason,
        updatedAt: now,
      },
    )

    if (packages.length === 0) {
      await this.dependencies.scans.complete(message.scanId, {
        status: sbom.partial ? 'partial' : 'complete',
        completedAt: now,
        updatedAt: now,
        riskScore: 0,
        kevCount: 0,
        counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        vulnerablePackageCount: 0,
        findingCount: 0,
        partialReason: sbom.partialReason,
      })
      return
    }

    const chunks = Array.from(
      { length: Math.ceil(packages.length / OSV_PACKAGES_PER_CHUNK) },
      (_, chunkIndex) => ({
        body: {
          type: 'CHECK_OSV' as const,
          scanId: message.scanId,
          chunkIndex,
          packageIds: packages
            .slice(
              chunkIndex * OSV_PACKAGES_PER_CHUNK,
              (chunkIndex + 1) * OSV_PACKAGES_PER_CHUNK,
            )
            .map((item) => item.id),
        },
      }),
    )
    await this.dependencies.scans.ensureChunks(message.scanId, chunks.length, now)
    await this.dependencies.scans.updateStatus(
      message.scanId,
      'checking',
      'Checking the packages for known problems.',
      now,
    )
    await this.dependencies.queue.sendBatch(chunks)
  }

  private async checkOsv(
    message: Extract<ScanQueueMessage, { type: 'CHECK_OSV' }>,
    attempts: number,
  ): Promise<void> {
    const nowDate = this.dependencies.now()
    const now = nowDate.toISOString()
    const staleBefore = new Date(
      attempts > 1 ? nowDate.getTime() + 1 : nowDate.getTime() - 5 * 60 * 1000,
    ).toISOString()
    const claimed = await this.dependencies.scans.claimChunk(
      message.scanId,
      message.chunkIndex,
      now,
      staleBefore,
    )
    if (!claimed) return

    const packages = await this.dependencies.scans.getPackagesByIds(
      message.scanId,
      message.packageIds,
    )
    const osv = await this.dependencies.osv.checkPackages(
      packages.map((item) => ({
        packageId: item.id,
        identity: {
          ecosystem: item.ecosystem,
          name: item.name,
          version: item.version,
          purl: item.purl,
        },
      })),
    )
    const warnings: string[] = []

    if (osv.partial) {
      warnings.push(PACKAGE_LIMIT_WARNING)
      await this.dependencies.scans.appendPartialReason(
        message.scanId,
        PACKAGE_LIMIT_WARNING,
        now,
      )
    }

    const findings: NewFinding[] = osv.findings.map((finding) => ({
      id: `${finding.packageId}:${finding.osvId}`,
      ...finding,
      isKev: false,
      kevDueDate: null,
      knownRansomwareUse: null,
    }))
    const stored = await this.dependencies.scans.upsertFindings(
      message.scanId,
      findings,
      now,
      this.dependencies.maxFindings,
    )

    if (this.dependencies.maxFindings !== null && stored.limited) {
      warnings.push(FINDING_LIMIT_WARNING)
      await this.dependencies.scans.appendPartialReason(
        message.scanId,
        FINDING_LIMIT_WARNING,
        now,
      )
    }

    const progress = await this.dependencies.scans.completeChunk(
      message.scanId,
      message.chunkIndex,
      now,
    )
    if (progress.total > 0 && progress.done === progress.total) {
      await this.finalize(message.scanId, warnings)
    }
  }

  private async finalize(scanId: string, warnings: string[]): Promise<void> {
    const now = this.dependencies.now().toISOString()
    const result = await this.dependencies.scans.getResult(scanId)
    if (!result || isFinished(result.status)) return

    let catalog: KevCatalog | null = null
    let cisaUnavailable = false

    if (result.findings.length > 0) {
      try {
        catalog = await this.dependencies.kev.load(this.dependencies.cache)
      } catch {
        cisaUnavailable = true
        warnings.push(CISA_WARNING)
        await this.dependencies.scans.appendPartialReason(scanId, CISA_WARNING, now)
      }
    }

    const findings: NewFinding[] = result.findings.map((finding) => {
      const kev = catalog ? matchKev(catalog, finding.aliases) : null
      return {
        id: finding.id,
        packageId: finding.packageId,
        osvId: finding.osvId,
        severity: finding.severity,
        summary: finding.summary,
        aliases: finding.aliases,
        fixedVersions: finding.fixedVersions,
        evidenceUrls: [...new Set([...finding.evidenceUrls, ...(kev?.evidenceUrls ?? [])])].slice(
          0,
          6,
        ),
        isKev: kev !== null,
        kevDueDate: kev?.dueDate ?? null,
        knownRansomwareUse: kev?.knownRansomwareUse ?? null,
      }
    })
    await this.dependencies.scans.upsertFindings(
      scanId,
      findings,
      now,
      this.dependencies.maxFindings,
    )
    const risk = calculateRisk(findings)
    const partialReason = mergeReasons(result.partialReason, ...warnings)
    const partial = result.partial || warnings.length > 0 || cisaUnavailable

    await this.dependencies.scans.complete(scanId, {
      status: partial ? 'partial' : 'complete',
      completedAt: now,
      updatedAt: now,
      riskScore: risk.score,
      kevCount: risk.kevCount,
      counts: risk.counts,
      vulnerablePackageCount: new Set(findings.map((finding) => finding.packageId)).size,
      findingCount: findings.length,
      partialReason,
    })
  }
}
