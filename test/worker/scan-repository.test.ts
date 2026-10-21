import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ScanRepository,
  type NewFinding,
  type NewPackage,
} from '../../src/server/db/scan-repository'

const now = '2026-08-06T14:00:00.000Z'

function repository() {
  return new ScanRepository(env.DB)
}

function newScan(id: string, overrides: Partial<Parameters<ScanRepository['create']>[0]> = {}) {
  return {
    id,
    repository: {
      owner: 'cloudflare',
      repository: 'workers-sdk',
      fullName: 'cloudflare/workers-sdk',
      cacheKey: 'cloudflare/workers-sdk',
      url: 'https://github.com/cloudflare/workers-sdk',
    },
    createdAt: now,
    expiresAt: '2026-09-05T14:00:00.000Z',
    ...overrides,
  }
}

const packages: NewPackage[] = [
  {
    id: 'package-1',
    spdxId: 'SPDXRef-Package-react',
    name: 'react',
    version: '19.2.8',
    ecosystem: 'npm',
    purl: 'pkg:npm/react@19.2.8',
    direct: true,
  },
]

const findings: NewFinding[] = [
  {
    id: 'finding-1',
    packageId: 'package-1',
    osvId: 'GHSA-test-test-test',
    severity: 'high',
    summary: 'Test finding',
    aliases: ['CVE-2026-0001'],
    fixedVersions: ['19.2.9'],
    evidenceUrls: ['https://osv.dev/vulnerability/GHSA-test-test-test'],
    isKev: true,
    kevDueDate: '2026-08-20',
    knownRansomwareUse: false,
  },
]

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM usage_limits'),
    env.DB.prepare('DELETE FROM scans'),
  ])
})

describe('ScanRepository', () => {
  it('creates and reads a queued scan', async () => {
    const scans = repository()
    await scans.create(newScan('scan-create'))

    const result = await scans.getResult('scan-create')

    expect(result).toMatchObject({
      scanId: 'scan-create',
      status: 'queued',
      statusMessage: 'Waiting to start.',
      packageCount: 0,
      findings: [],
    })
  })

  it('finds only a fresh completed result for repository reuse', async () => {
    const scans = repository()
    await scans.create(newScan('scan-reuse'))
    await scans.complete('scan-reuse', {
      status: 'complete',
      completedAt: '2026-08-06T14:05:00.000Z',
      updatedAt: '2026-08-06T14:05:00.000Z',
      riskScore: 0,
      kevCount: 0,
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      vulnerablePackageCount: 0,
      findingCount: 0,
      partialReason: null,
    })

    await expect(
      scans.findFreshByRepository('cloudflare/workers-sdk', '2026-08-06T13:00:00.000Z'),
    ).resolves.toMatchObject({ id: 'scan-reuse', status: 'complete' })
    await expect(
      scans.findFreshByRepository('cloudflare/workers-sdk', '2026-08-06T15:00:00.000Z'),
    ).resolves.toBeNull()
  })

  it('stores packages, edges, and findings for the public result', async () => {
    const scans = repository()
    await scans.create(newScan('scan-result'))
    await scans.replaceInventory(
      'scan-result',
      packages,
      [
        {
          sourceSpdxId: 'SPDXRef-DOCUMENT',
          targetSpdxId: 'SPDXRef-Package-react',
          relationship: 'DEPENDS_ON',
        },
      ],
      { partial: false, partialReason: null, updatedAt: now },
    )
    await scans.upsertFindings('scan-result', findings, now)

    const result = await scans.getResult('scan-result')

    expect(result?.packages[0]).toMatchObject({ name: 'react', direct: true })
    expect(result?.edges).toHaveLength(1)
    expect(result?.findings[0]).toMatchObject({
      aliases: ['CVE-2026-0001'],
      fixedVersions: ['19.2.9'],
      isKev: true,
      knownRansomwareUse: false,
    })
  })

  it('enforces the finding cap and keeps partial reasons unique', async () => {
    const scans = repository()
    await scans.create(newScan('scan-capped'))
    await scans.replaceInventory('scan-capped', packages, [], {
      partial: false,
      partialReason: null,
      updatedAt: now,
    })
    const stored = await scans.upsertFindings(
      'scan-capped',
      [
        findings[0],
        {
          ...findings[0],
          id: 'finding-2',
          osvId: 'GHSA-second-test-test',
        },
      ],
      now,
      1,
    )
    await scans.appendPartialReason('scan-capped', 'Finding limit reached.', now)
    await scans.appendPartialReason('scan-capped', 'Finding limit reached.', now)
    await scans.appendPartialReason('scan-capped', 'Another check was skipped.', now)

    expect(stored).toEqual({ limited: true, total: 1 })
    await expect(
      scans.getPackagesByIds('scan-capped', ['package-1']),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'package-1', name: 'react' }),
    ])
    await expect(scans.getResult('scan-capped')).resolves.toMatchObject({
      partial: true,
      partialReason: 'Finding limit reached. Another check was skipped.',
      findings: [expect.objectContaining({ id: 'finding-1' })],
    })
  })

  it('stores every finding when the local limit is disabled', async () => {
    const scans = repository()
    await scans.create(newScan('scan-full-findings'))
    await scans.replaceInventory('scan-full-findings', packages, [], {
      partial: false,
      partialReason: null,
      updatedAt: now,
    })
    const fullFindings = Array.from({ length: 601 }, (_, index) => ({
      ...findings[0],
      id: `finding-${index}`,
      osvId: `GHSA-full-${index}`,
    }))

    const stored = await scans.upsertFindings(
      'scan-full-findings',
      fullFindings,
      now,
      null,
    )

    expect(stored).toEqual({ limited: false, total: 601 })
    const result = await scans.getResult('scan-full-findings')
    expect(result?.findings).toHaveLength(601)
  })

  it('completes queue chunks only once when a message is retried', async () => {
    const scans = repository()
    await scans.create(newScan('scan-chunks'))
    await scans.ensureChunks('scan-chunks', 2, now)

    await expect(
      scans.claimChunk('scan-chunks', 0, now, '2026-08-06T13:55:00.000Z'),
    ).resolves.toBe(true)
    await expect(scans.completeChunk('scan-chunks', 0, now)).resolves.toEqual({
      done: 1,
      total: 2,
    })
    await expect(scans.completeChunk('scan-chunks', 0, now)).resolves.toEqual({
      done: 1,
      total: 2,
    })
    await scans.claimChunk('scan-chunks', 1, now, '2026-08-06T13:55:00.000Z')
    await expect(scans.completeChunk('scan-chunks', 1, now)).resolves.toEqual({
      done: 2,
      total: 2,
    })
  })

  it('marks a failed scan without exposing an internal error', async () => {
    const scans = repository()
    await scans.create(newScan('scan-failed'))
    await scans.fail(
      'scan-failed',
      'GITHUB_UNAVAILABLE',
      'GitHub could not provide this project. Try again later.',
      now,
    )

    await expect(scans.getResult('scan-failed')).resolves.toMatchObject({
      status: 'failed',
      statusMessage: 'GitHub could not provide this project. Try again later.',
    })
  })

  it('deletes expired scans and their child rows in a small batch', async () => {
    const scans = repository()
    await scans.create(
      newScan('scan-expired', { expiresAt: '2026-08-01T00:00:00.000Z' }),
    )
    await scans.replaceInventory('scan-expired', packages, [], {
      partial: false,
      partialReason: null,
      updatedAt: now,
    })

    await expect(scans.deleteExpired(now, 5)).resolves.toBe(1)
    await expect(scans.getResult('scan-expired')).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT COUNT(*) AS count FROM packages WHERE scan_id = ?')
        .bind('scan-expired')
        .first<{ count: number }>('count'),
    ).resolves.toBe(0)
  })
})
