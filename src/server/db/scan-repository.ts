import type {
  DependencyEdge,
  RepositoryReference,
  ScanFinding,
  ScanPackage,
  ScanResultResponse,
  ScanStatus,
  Severity,
  SeverityCounts,
} from '../../shared/contracts'
import type { EdgeRow, FindingRow, PackageRow, ScanRow } from './types'

const STATEMENTS_PER_BATCH = 50

export type NewScan = {
  id: string
  repository: RepositoryReference
  createdAt: string
  expiresAt: string
}

export type NewPackage = {
  id: string
  spdxId: string
  name: string
  version: string | null
  ecosystem: string
  purl: string
  direct: boolean
}

export type NewEdge = DependencyEdge

export type NewFinding = {
  id: string
  packageId: string
  osvId: string
  severity: Severity
  summary: string
  aliases: string[]
  fixedVersions: string[]
  evidenceUrls: string[]
  isKev: boolean
  kevDueDate: string | null
  knownRansomwareUse: boolean | null
}

export type StoredScan = {
  id: string
  status: ScanStatus
  statusMessage: string
  repositoryCacheKey: string
  completedAt: string | null
  errorCode: string | null
}

type Completion = {
  status: 'complete' | 'partial'
  completedAt: string
  updatedAt: string
  riskScore: number
  kevCount: number
  counts: SeverityCounts
  vulnerablePackageCount: number
  findingCount: number
  partialReason: string | null
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function toStoredScan(row: ScanRow): StoredScan {
  return {
    id: row.id,
    status: row.status,
    statusMessage: row.status_message,
    repositoryCacheKey: row.repository_cache_key,
    completedAt: row.completed_at,
    errorCode: row.error_code,
  }
}

export class ScanRepository {
  constructor(private readonly database: D1Database) {}

  async create(input: NewScan): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO scans (
          id, repository_owner, repository_name, repository_full_name,
          repository_cache_key, repository_url, status, status_message,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'Waiting to start.', ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.repository.owner,
        input.repository.repository,
        input.repository.fullName,
        input.repository.cacheKey,
        input.repository.url,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
      )
      .run()
  }

  async get(id: string): Promise<StoredScan | null> {
    const row = await this.database
      .prepare('SELECT * FROM scans WHERE id = ?')
      .bind(id)
      .first<ScanRow>()

    return row ? toStoredScan(row) : null
  }

  async findFreshByRepository(
    cacheKey: string,
    freshAfter: string,
  ): Promise<StoredScan | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM scans
         WHERE repository_cache_key = ?
           AND status IN ('complete', 'partial')
           AND completed_at >= ?
         ORDER BY completed_at DESC
         LIMIT 1`,
      )
      .bind(cacheKey, freshAfter)
      .first<ScanRow>()

    return row ? toStoredScan(row) : null
  }

  async updateStatus(
    id: string,
    status: 'fetching' | 'checking',
    message: string,
    updatedAt: string,
  ): Promise<void> {
    await this.database
      .prepare(
        'UPDATE scans SET status = ?, status_message = ?, updated_at = ?, error_code = NULL WHERE id = ?',
      )
      .bind(status, message, updatedAt, id)
      .run()
  }

  async replaceInventory(
    scanId: string,
    packages: NewPackage[],
    edges: NewEdge[],
    state: { partial: boolean; partialReason: string | null; updatedAt: string },
  ): Promise<void> {
    await this.database.batch([
      this.database.prepare('DELETE FROM dependency_edges WHERE scan_id = ?').bind(scanId),
      this.database.prepare('DELETE FROM packages WHERE scan_id = ?').bind(scanId),
    ])

    await this.runBatches(
      packages.map((item) =>
        this.database
          .prepare(
            `INSERT INTO packages (
              id, scan_id, spdx_id, name, version, ecosystem, purl, direct
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (scan_id, spdx_id) DO UPDATE SET
              id = excluded.id,
              name = excluded.name,
              version = excluded.version,
              ecosystem = excluded.ecosystem,
              purl = excluded.purl,
              direct = excluded.direct`,
          )
          .bind(
            item.id,
            scanId,
            item.spdxId,
            item.name,
            item.version,
            item.ecosystem,
            item.purl,
            item.direct ? 1 : 0,
          ),
      ),
    )

    await this.runBatches(
      edges.map((edge) =>
        this.database
          .prepare(
            `INSERT OR IGNORE INTO dependency_edges (
              scan_id, source_spdx_id, target_spdx_id, relationship
            ) VALUES (?, ?, ?, ?)`,
          )
          .bind(
            scanId,
            edge.sourceSpdxId,
            edge.targetSpdxId,
            edge.relationship,
          ),
      ),
    )

    await this.database
      .prepare(
        `UPDATE scans SET
          package_count = ?, partial = ?, partial_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        packages.length,
        state.partial ? 1 : 0,
        state.partialReason,
        state.updatedAt,
        scanId,
      )
      .run()
  }

  async upsertFindings(
    scanId: string,
    findings: NewFinding[],
    createdAt: string,
    limit: number | null = 600,
  ): Promise<{ limited: boolean; total: number }> {
    const effectiveLimit = limit ?? Number.MAX_SAFE_INTEGER
    const statements = findings.map((finding) =>
        this.database
          .prepare(
            `INSERT INTO findings (
              id, scan_id, package_id, osv_id, severity, summary,
              aliases_json, fixed_versions_json, evidence_urls_json,
              is_kev, kev_due_date, known_ransomware_use, created_at
            ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM findings
              WHERE scan_id = ? AND package_id = ? AND osv_id = ?
            ) OR (
              SELECT COUNT(*) FROM findings WHERE scan_id = ?
            ) < ?
            ON CONFLICT (scan_id, package_id, osv_id) DO UPDATE SET
              severity = excluded.severity,
              summary = excluded.summary,
              aliases_json = excluded.aliases_json,
              fixed_versions_json = excluded.fixed_versions_json,
              evidence_urls_json = excluded.evidence_urls_json,
              is_kev = excluded.is_kev,
              kev_due_date = excluded.kev_due_date,
              known_ransomware_use = excluded.known_ransomware_use`,
          )
          .bind(
            finding.id,
            scanId,
            finding.packageId,
            finding.osvId,
            finding.severity,
            finding.summary,
            JSON.stringify(finding.aliases),
            JSON.stringify(finding.fixedVersions),
            JSON.stringify(finding.evidenceUrls),
            finding.isKev ? 1 : 0,
            finding.kevDueDate,
            finding.knownRansomwareUse === null
              ? null
              : finding.knownRansomwareUse
                ? 1
                : 0,
            createdAt,
            scanId,
            finding.packageId,
            finding.osvId,
            scanId,
            effectiveLimit,
          ),
      )
    let limited = false

    for (let index = 0; index < statements.length; index += STATEMENTS_PER_BATCH) {
      const batch = await this.database.batch(
        statements.slice(index, index + STATEMENTS_PER_BATCH),
      )
      if (batch.some((item) => item.meta.changes === 0)) limited = true
    }

    await this.database
      .prepare(
        `UPDATE packages SET vulnerability_count = (
          SELECT COUNT(*) FROM findings WHERE findings.package_id = packages.id
        ) WHERE scan_id = ?`,
      )
      .bind(scanId)
      .run()

    const total =
      (await this.database
        .prepare('SELECT COUNT(*) AS count FROM findings WHERE scan_id = ?')
        .bind(scanId)
        .first<number>('count')) ?? 0

    return { limited, total }
  }

  async getPackagesByIds(scanId: string, ids: string[]): Promise<ScanPackage[]> {
    if (ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(', ')
    const result = await this.database
      .prepare(
        `SELECT * FROM packages
         WHERE scan_id = ? AND id IN (${placeholders})
         ORDER BY id`,
      )
      .bind(scanId, ...ids)
      .all<PackageRow>()

    return result.results.map((item) => ({
      id: item.id,
      spdxId: item.spdx_id,
      name: item.name,
      version: item.version,
      ecosystem: item.ecosystem,
      purl: item.purl,
      direct: item.direct === 1,
      vulnerabilityCount: item.vulnerability_count,
    }))
  }

  async appendPartialReason(id: string, reason: string, updatedAt: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE scans SET
          partial = 1,
          partial_reason = CASE
            WHEN partial_reason IS NULL OR partial_reason = '' THEN ?
            WHEN instr(partial_reason, ?) > 0 THEN partial_reason
            ELSE partial_reason || ' ' || ?
          END,
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(reason, reason, reason, updatedAt, id)
      .run()
  }

  async ensureChunks(scanId: string, total: number, updatedAt: string): Promise<void> {
    await this.runBatches(
      Array.from({ length: total }, (_, index) =>
        this.database
          .prepare(
            `INSERT OR IGNORE INTO scan_chunks (scan_id, chunk_index, status, updated_at)
             VALUES (?, ?, 'pending', ?)`,
          )
          .bind(scanId, index, updatedAt),
      ),
    )

    await this.database
      .prepare(
        `UPDATE scans SET
          osv_chunks_total = (SELECT COUNT(*) FROM scan_chunks WHERE scan_id = ?),
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(scanId, updatedAt, scanId)
      .run()
  }

  async claimChunk(
    scanId: string,
    chunkIndex: number,
    updatedAt: string,
    staleBefore: string,
  ): Promise<boolean> {
    const claimed = await this.database
      .prepare(
        `UPDATE scan_chunks SET status = 'running', updated_at = ?
         WHERE scan_id = ? AND chunk_index = ?
           AND (
             status IN ('pending', 'failed')
             OR (status = 'running' AND updated_at < ?)
           )
         RETURNING chunk_index`,
      )
      .bind(updatedAt, scanId, chunkIndex, staleBefore)
      .first<{ chunk_index: number }>()

    return claimed !== null
  }

  async failChunk(scanId: string, chunkIndex: number, updatedAt: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE scan_chunks SET status = 'failed', updated_at = ?
         WHERE scan_id = ? AND chunk_index = ? AND status <> 'complete'`,
      )
      .bind(updatedAt, scanId, chunkIndex)
      .run()
  }

  async completeChunk(
    scanId: string,
    chunkIndex: number,
    updatedAt: string,
  ): Promise<{ done: number; total: number }> {
    await this.database
      .prepare(
        `UPDATE scan_chunks SET status = 'complete', updated_at = ?
         WHERE scan_id = ? AND chunk_index = ? AND status <> 'complete'`,
      )
      .bind(updatedAt, scanId, chunkIndex)
      .run()

    const progress = await this.database
      .prepare(
        `UPDATE scans SET
          osv_chunks_done = (
            SELECT COUNT(*) FROM scan_chunks
            WHERE scan_id = ? AND status = 'complete'
          ),
          updated_at = ?
         WHERE id = ?
         RETURNING osv_chunks_done, osv_chunks_total`,
      )
      .bind(scanId, updatedAt, scanId)
      .first<{ osv_chunks_done: number; osv_chunks_total: number }>()

    return {
      done: progress?.osv_chunks_done ?? 0,
      total: progress?.osv_chunks_total ?? 0,
    }
  }

  async complete(id: string, completion: Completion): Promise<void> {
    const message =
      completion.status === 'partial'
        ? 'Scan complete with some checks skipped.'
        : 'Scan complete.'

    await this.database
      .prepare(
        `UPDATE scans SET
          status = ?, status_message = ?, vulnerable_package_count = ?,
          finding_count = ?, critical_count = ?, high_count = ?, medium_count = ?,
          low_count = ?, unknown_count = ?, risk_score = ?, kev_count = ?,
          partial = ?, partial_reason = ?, error_code = NULL,
          updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .bind(
        completion.status,
        message,
        completion.vulnerablePackageCount,
        completion.findingCount,
        completion.counts.critical,
        completion.counts.high,
        completion.counts.medium,
        completion.counts.low,
        completion.counts.unknown,
        completion.riskScore,
        completion.kevCount,
        completion.status === 'partial' ? 1 : 0,
        completion.partialReason,
        completion.updatedAt,
        completion.completedAt,
        id,
      )
      .run()
  }

  async fail(
    id: string,
    errorCode: string,
    publicMessage: string,
    updatedAt: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE scans SET
          status = 'failed', status_message = ?, error_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(publicMessage, errorCode, updatedAt, id)
      .run()
  }

  async getResult(id: string): Promise<ScanResultResponse | null> {
    const row = await this.database
      .prepare('SELECT * FROM scans WHERE id = ?')
      .bind(id)
      .first<ScanRow>()

    if (!row) return null

    const [packageResult, edgeResult, findingResult] = await Promise.all([
      this.database
        .prepare('SELECT * FROM packages WHERE scan_id = ? ORDER BY direct DESC, name ASC')
        .bind(id)
        .all<PackageRow>(),
      this.database
        .prepare(
          'SELECT * FROM dependency_edges WHERE scan_id = ? ORDER BY source_spdx_id, target_spdx_id',
        )
        .bind(id)
        .all<EdgeRow>(),
      this.database
        .prepare(
          `SELECT * FROM findings WHERE scan_id = ?
           ORDER BY CASE severity
             WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
             WHEN 'low' THEN 4 ELSE 5 END, osv_id`,
        )
        .bind(id)
        .all<FindingRow>(),
    ])

    const packages: ScanPackage[] = packageResult.results.map((item) => ({
      id: item.id,
      spdxId: item.spdx_id,
      name: item.name,
      version: item.version,
      ecosystem: item.ecosystem,
      purl: item.purl,
      direct: item.direct === 1,
      vulnerabilityCount: item.vulnerability_count,
    }))
    const edges: DependencyEdge[] = edgeResult.results.map((item) => ({
      sourceSpdxId: item.source_spdx_id,
      targetSpdxId: item.target_spdx_id,
      relationship: item.relationship,
    }))
    const findings: ScanFinding[] = findingResult.results.map((item) => ({
      id: item.id,
      packageId: item.package_id,
      osvId: item.osv_id,
      severity: item.severity,
      summary: item.summary,
      aliases: parseStringArray(item.aliases_json),
      fixedVersions: parseStringArray(item.fixed_versions_json),
      evidenceUrls: parseStringArray(item.evidence_urls_json),
      isKev: item.is_kev === 1,
      kevDueDate: item.kev_due_date,
      knownRansomwareUse:
        item.known_ransomware_use === null
          ? null
          : item.known_ransomware_use === 1,
    }))

    return {
      scanId: row.id,
      status: row.status,
      statusMessage: row.status_message,
      repository: {
        owner: row.repository_owner,
        repository: row.repository_name,
        fullName: row.repository_full_name,
        cacheKey: row.repository_cache_key,
        url: row.repository_url,
      },
      createdAt: row.created_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      partial: row.partial === 1,
      partialReason: row.partial_reason,
      riskScore: row.risk_score,
      kevCount: row.kev_count,
      severityCounts: {
        critical: row.critical_count,
        high: row.high_count,
        medium: row.medium_count,
        low: row.low_count,
        unknown: row.unknown_count,
      },
      packageCount: row.package_count,
      vulnerablePackageCount: row.vulnerable_package_count,
      findingCount: row.finding_count,
      packages,
      edges,
      findings,
    }
  }

  async deleteExpired(now: string, limit: number): Promise<number> {
    const result = await this.database
      .prepare(
        `DELETE FROM scans WHERE id IN (
          SELECT id FROM scans WHERE expires_at < ? ORDER BY expires_at LIMIT ?
        ) RETURNING id`,
      )
      .bind(now, limit)
      .all<{ id: string }>()

    return result.results.length
  }

  private async runBatches(statements: D1PreparedStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += STATEMENTS_PER_BATCH) {
      await this.database.batch(statements.slice(index, index + STATEMENTS_PER_BATCH))
    }
  }
}
