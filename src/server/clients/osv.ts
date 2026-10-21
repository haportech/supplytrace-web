import type { PackageIdentity, Severity } from '../../shared/contracts'
import {
  extractFixedVersions,
  normalizeSeverity,
  type OsvAffectedLike,
} from '../domain/finding'
import { JsonHttpClient, safeHttpsUrls, UpstreamError } from './http'

const OSV_API_ROOT = 'https://api.osv.dev/v1'
const MAX_PACKAGES_PER_JOB = 20
const MAX_DETAILS_PER_JOB = 40
const DETAIL_CONCURRENCY = 8

export type OsvPackageInput = {
  packageId: string
  identity: PackageIdentity
}

export type OsvFinding = {
  packageId: string
  osvId: string
  severity: Severity
  summary: string
  aliases: string[]
  fixedVersions: string[]
  evidenceUrls: string[]
}

export type OsvCheckResult = {
  findings: OsvFinding[]
  partial: boolean
  partialReason: string | null
  skippedPackageCount: number
}

type OsvDetail = {
  id?: unknown
  aliases?: unknown
  summary?: unknown
  details?: unknown
  severity?: unknown
  database_specific?: unknown
  affected?: unknown
  references?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isExactPackageVersion(version: string | null): version is string {
  if (!version) return false
  const value = version.trim()
  return (
    value.length > 0 &&
    value.length <= 120 &&
    !/^[~^<>=*]/.test(value) &&
    !/[\s*,]/.test(value) &&
    !value.includes('||') &&
    !['latest', 'unknown', 'noassertion'].includes(value.toLowerCase())
  )
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  return results
}

function publicSummary(detail: OsvDetail, id: string): string {
  const source =
    typeof detail.summary === 'string'
      ? detail.summary
      : typeof detail.details === 'string'
        ? detail.details
        : `Known vulnerability ${id}`
  const normalized = source.replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 280) || `Known vulnerability ${id}`
}

function detailSeverity(detail: OsvDetail): Severity {
  const databaseSeverity = isRecord(detail.database_specific)
    ? detail.database_specific.severity
    : undefined
  const scores = Array.isArray(detail.severity)
    ? detail.severity.flatMap((item) =>
        isRecord(item) && 'score' in item ? [item.score] : [],
      )
    : []

  return normalizeSeverity(databaseSeverity, ...scores)
}

export class OsvClient {
  private readonly http: JsonHttpClient
  private readonly fullScan: boolean

  constructor(options: { fetcher?: typeof fetch; fullScan?: boolean } = {}) {
    this.http = new JsonHttpClient(options.fetcher)
    this.fullScan = options.fullScan ?? false
  }

  async checkPackages(inputs: OsvPackageInput[]): Promise<OsvCheckResult> {
    const candidates = inputs.filter((item) => isExactPackageVersion(item.identity.version))
    const queryable = candidates.slice(0, MAX_PACKAGES_PER_JOB)
    const skippedPackageCount = inputs.length - queryable.length

    if (queryable.length === 0) {
      return {
        findings: [],
        partial: skippedPackageCount > 0,
        partialReason:
          skippedPackageCount > 0
            ? `${skippedPackageCount} package versions were unclear, so they were not checked.`
            : null,
        skippedPackageCount,
      }
    }

    const payload = await this.http.request<unknown>(
      `${OSV_API_ROOT}/querybatch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: queryable.map((item) => ({
            version: item.identity.version,
            package: {
              ecosystem: item.identity.ecosystem,
              name: item.identity.name,
            },
          })),
        }),
      },
      {
        service: 'OSV',
        maxBytes: 512 * 1024,
        timeoutMs: 15_000,
        unavailableMessage: 'The safety check is not available. Try again later.',
        statusCodes: {
          429: {
            code: 'OSV_RATE_LIMITED',
            message: 'The safety check is busy. Try again in a few minutes.',
          },
        },
      },
    )

    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw this.invalidResponse()
    }

    if (payload.results.length !== queryable.length) {
      throw this.invalidResponse()
    }

    const occurrences = new Map<string, OsvPackageInput[]>()

    payload.results.forEach((result, index) => {
      if (!isRecord(result)) throw this.invalidResponse()
      if (result.vulns === undefined) return
      if (!Array.isArray(result.vulns)) throw this.invalidResponse()

      for (const vulnerability of result.vulns) {
        if (!isRecord(vulnerability) || typeof vulnerability.id !== 'string') {
          throw this.invalidResponse()
        }

        const id = vulnerability.id.trim()
        if (id.length === 0 || id.length > 160) throw this.invalidResponse()
        const packages = occurrences.get(id) ?? []
        packages.push(queryable[index])
        occurrences.set(id, packages)
      }
    })

    const allIds = [...occurrences.keys()]
    const detailIds = this.fullScan
      ? allIds
      : allIds.slice(0, MAX_DETAILS_PER_JOB)
    const details = await mapWithConcurrency(
      detailIds,
      DETAIL_CONCURRENCY,
      async (id) => this.loadDetail(id),
    )
    const findings: OsvFinding[] = []

    details.forEach((detail, detailIndex) => {
      const id = detailIds[detailIndex]
      const aliases = Array.isArray(detail.aliases)
        ? detail.aliases.filter((item): item is string => typeof item === 'string').slice(0, 40)
        : []
      const references = Array.isArray(detail.references)
        ? detail.references.flatMap((item) =>
            isRecord(item) && typeof item.url === 'string' ? [item.url] : [],
          )
        : []
      const evidenceUrls = safeHttpsUrls(
        [`https://osv.dev/vulnerability/${encodeURIComponent(id)}`, ...references],
        6,
      )
      const affected = Array.isArray(detail.affected)
        ? (detail.affected as OsvAffectedLike[])
        : []

      for (const item of occurrences.get(id) ?? []) {
        findings.push({
          packageId: item.packageId,
          osvId: id,
          severity: detailSeverity(detail),
          summary: publicSummary(detail, id),
          aliases,
          fixedVersions: extractFixedVersions(affected, item.identity),
          evidenceUrls,
        })
      }
    })

    const detailsLimited = !this.fullScan && allIds.length > MAX_DETAILS_PER_JOB
    const partial = skippedPackageCount > 0 || detailsLimited
    const reasons: string[] = []

    if (skippedPackageCount > 0) {
      reasons.push(`${skippedPackageCount} package versions were unclear, so they were not checked.`)
    }
    if (detailsLimited) {
      reasons.push(`Only the first ${MAX_DETAILS_PER_JOB} known problems were loaded.`)
    }

    return {
      findings,
      partial,
      partialReason: reasons.length > 0 ? reasons.join(' ') : null,
      skippedPackageCount,
    }
  }

  private async loadDetail(id: string): Promise<OsvDetail> {
    const detail = await this.http.request<unknown>(
      `${OSV_API_ROOT}/vulns/${encodeURIComponent(id)}`,
      { method: 'GET', headers: { accept: 'application/json' } },
      {
        service: 'OSV',
        maxBytes: 1024 * 1024,
        timeoutMs: 15_000,
        unavailableMessage: 'The safety check is not available. Try again later.',
      },
    )

    if (!isRecord(detail) || detail.id !== id) throw this.invalidResponse()
    return detail
  }

  private invalidResponse(): UpstreamError {
    return new UpstreamError(
      'OSV_INVALID_RESPONSE',
      'The safety check sent data we could not read. Try again later.',
    )
  }
}
