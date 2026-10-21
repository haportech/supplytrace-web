import { describe, expect, it, vi } from 'vitest'

import { UpstreamError } from '../../src/server/clients/http'
import {
  ScanWorker,
  type ScanWorkerDependencies,
} from '../../src/server/services/scan-worker'
import type { ScanResultResponse } from '../../src/shared/contracts'

function result(overrides: Partial<ScanResultResponse> = {}): ScanResultResponse {
  return {
    scanId: 'scan-1',
    status: 'checking',
    statusMessage: 'Checking packages.',
    repository: {
      owner: 'owner',
      repository: 'repo',
      fullName: 'owner/repo',
      cacheKey: 'owner/repo',
      url: 'https://github.com/owner/repo',
    },
    createdAt: '2026-08-06T14:00:00.000Z',
    completedAt: null,
    expiresAt: '2026-09-05T14:00:00.000Z',
    partial: false,
    partialReason: null,
    riskScore: 0,
    kevCount: 0,
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    packageCount: 1,
    vulnerablePackageCount: 0,
    findingCount: 1,
    packages: [
      {
        id: 'scan-1:package:0',
        spdxId: 'SPDXRef-Package-lodash',
        ecosystem: 'npm',
        name: 'lodash',
        version: '4.17.20',
        purl: 'pkg:npm/lodash@4.17.20',
        direct: true,
        vulnerabilityCount: 1,
      },
    ],
    edges: [],
    findings: [
      {
        id: 'scan-1:package:0:GHSA-test',
        packageId: 'scan-1:package:0',
        osvId: 'GHSA-test',
        severity: 'high',
        summary: 'Test issue',
        aliases: ['CVE-2026-0001'],
        fixedVersions: ['4.17.21'],
        evidenceUrls: ['https://osv.dev/vulnerability/GHSA-test'],
        isKev: false,
        kevDueDate: null,
        knownRansomwareUse: null,
      },
    ],
    ...overrides,
  }
}

function dependencies(): ScanWorkerDependencies {
  return {
    scans: {
      get: vi.fn().mockResolvedValue({
        id: 'scan-1',
        status: 'queued',
        statusMessage: 'Waiting to start.',
        repositoryCacheKey: 'owner/repo',
        completedAt: null,
        errorCode: null,
      }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      replaceInventory: vi.fn().mockResolvedValue(undefined),
      ensureChunks: vi.fn().mockResolvedValue(undefined),
      getPackagesByIds: vi.fn().mockResolvedValue(result().packages),
      claimChunk: vi.fn().mockResolvedValue(true),
      failChunk: vi.fn().mockResolvedValue(undefined),
      completeChunk: vi.fn().mockResolvedValue({ done: 1, total: 1 }),
      upsertFindings: vi.fn().mockResolvedValue({ limited: false, total: 1 }),
      appendPartialReason: vi.fn().mockResolvedValue(undefined),
      getResult: vi.fn().mockResolvedValue(result()),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    },
    github: {
      loadSbom: vi.fn().mockResolvedValue({
        rootSpdxId: 'SPDXRef-DOCUMENT',
        packages: [
          {
            spdxId: 'SPDXRef-Package-lodash',
            ecosystem: 'npm',
            name: 'lodash',
            version: '4.17.20',
            purl: 'pkg:npm/lodash@4.17.20',
            direct: true,
          },
        ],
        edges: [],
        partial: false,
        partialReason: null,
        skippedUnsupportedCount: 0,
      }),
    },
    osv: {
      checkPackages: vi.fn().mockResolvedValue({
        findings: [
          {
            packageId: 'scan-1:package:0',
            osvId: 'GHSA-test',
            severity: 'high',
            summary: 'Test issue',
            aliases: ['CVE-2026-0001'],
            fixedVersions: ['4.17.21'],
            evidenceUrls: ['https://osv.dev/vulnerability/GHSA-test'],
          },
        ],
        partial: false,
        partialReason: null,
        skippedPackageCount: 0,
      }),
    },
    kev: {
      load: vi.fn().mockResolvedValue(
        new Map([
          [
            'CVE-2026-0001',
            {
              cveId: 'CVE-2026-0001',
              dueDate: '2026-08-20',
              knownRansomwareUse: true,
              evidenceUrls: ['https://www.cisa.gov/example'],
            },
          ],
        ]),
      ),
    },
    queue: {
      send: vi.fn().mockResolvedValue(undefined),
      sendBatch: vi.fn().mockResolvedValue(undefined),
    },
    maxFindings: 600,
    cache: undefined,
    now: () => new Date('2026-08-06T14:30:00.000Z'),
  }
}

describe('ScanWorker', () => {
  it('turns an SBOM into small OSV queue jobs', async () => {
    const deps = dependencies()
    const decision = await new ScanWorker(deps).process(
      {
        type: 'FETCH_SBOM',
        scanId: 'scan-1',
        repositoryUrl: 'https://github.com/owner/repo',
      },
      1,
    )

    expect(decision).toEqual({ action: 'ack' })
    expect(deps.scans.replaceInventory).toHaveBeenCalledWith(
      'scan-1',
      [
        expect.objectContaining({
          id: 'scan-1:package:0',
          name: 'lodash',
        }),
      ],
      [],
      expect.objectContaining({ partial: false }),
    )
    expect(deps.scans.ensureChunks).toHaveBeenCalledWith(
      'scan-1',
      1,
      '2026-08-06T14:30:00.000Z',
    )
    expect(deps.queue.sendBatch).toHaveBeenCalledWith([
      {
        body: {
          type: 'CHECK_OSV',
          scanId: 'scan-1',
          chunkIndex: 0,
          packageIds: ['scan-1:package:0'],
        },
      },
    ])
  })

  it('finishes an empty SBOM without creating OSV jobs', async () => {
    const deps = dependencies()
    vi.mocked(deps.github.loadSbom).mockResolvedValue({
      rootSpdxId: 'SPDXRef-DOCUMENT',
      packages: [],
      edges: [],
      partial: false,
      partialReason: null,
      skippedUnsupportedCount: 0,
    })

    await new ScanWorker(deps).process(
      {
        type: 'FETCH_SBOM',
        scanId: 'scan-1',
        repositoryUrl: 'https://github.com/owner/repo',
      },
      1,
    )

    expect(deps.queue.sendBatch).not.toHaveBeenCalled()
    expect(deps.scans.complete).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ status: 'complete', riskScore: 0, findingCount: 0 }),
    )
  })

  it('retries queue dispatch without letting a fast consumer overwrite completion', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.get)
      .mockResolvedValueOnce({
        id: 'scan-1',
        status: 'queued',
        statusMessage: 'Waiting to start.',
        repositoryCacheKey: 'owner/repo',
        completedAt: null,
        errorCode: null,
      })
      .mockResolvedValueOnce({
        id: 'scan-1',
        status: 'checking',
        statusMessage: 'Checking the packages for known problems.',
        repositoryCacheKey: 'owner/repo',
        completedAt: null,
        errorCode: null,
      })
    vi.mocked(deps.queue.sendBatch)
      .mockRejectedValueOnce(new Error('temporary queue failure'))
      .mockResolvedValueOnce(undefined)
    const worker = new ScanWorker(deps)
    const message = {
      type: 'FETCH_SBOM' as const,
      scanId: 'scan-1',
      repositoryUrl: 'https://github.com/owner/repo',
    }

    await expect(worker.process(message, 1)).resolves.toEqual({
      action: 'retry',
      delaySeconds: 4,
    })
    await expect(worker.process(message, 2)).resolves.toEqual({ action: 'ack' })
    expect(deps.queue.sendBatch).toHaveBeenCalledTimes(2)
    expect(deps.scans.updateStatus).toHaveBeenCalledWith(
      'scan-1',
      'checking',
      'Checking the packages for known problems.',
      '2026-08-06T14:30:00.000Z',
    )
  })

  it('stores OSV evidence, adds CISA KEV data, and calculates final risk', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo',
      completedAt: null,
      errorCode: null,
    })

    const decision = await new ScanWorker(deps).process(
      {
        type: 'CHECK_OSV',
        scanId: 'scan-1',
        chunkIndex: 0,
        packageIds: ['scan-1:package:0'],
      },
      1,
    )

    expect(decision).toEqual({ action: 'ack' })
    expect(deps.scans.upsertFindings).toHaveBeenLastCalledWith(
      'scan-1',
      [
        expect.objectContaining({
          osvId: 'GHSA-test',
          isKev: true,
          kevDueDate: '2026-08-20',
          knownRansomwareUse: true,
        }),
      ],
      '2026-08-06T14:30:00.000Z',
      600,
    )
    expect(deps.scans.complete).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({
        status: 'complete',
        riskScore: 21,
        kevCount: 1,
        findingCount: 1,
        vulnerablePackageCount: 1,
      }),
    )
  })

  it('does not cap findings in local full mode', async () => {
    const deps = { ...dependencies(), maxFindings: null }
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo:full',
      completedAt: null,
      errorCode: null,
    })

    await new ScanWorker(deps).process(
      {
        type: 'CHECK_OSV',
        scanId: 'scan-1',
        chunkIndex: 0,
        packageIds: ['scan-1:package:0'],
      },
      1,
    )

    expect(deps.scans.upsertFindings).toHaveBeenLastCalledWith(
      'scan-1',
      expect.any(Array),
      '2026-08-06T14:30:00.000Z',
      null,
    )
    expect(deps.scans.appendPartialReason).not.toHaveBeenCalledWith(
      'scan-1',
      expect.stringContaining('first 600'),
      expect.any(String),
    )
  })

  it('returns a partial result when CISA is unavailable', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo',
      completedAt: null,
      errorCode: null,
    })
    vi.mocked(deps.kev.load).mockRejectedValue(
      new UpstreamError('CISA_UNAVAILABLE', 'CISA unavailable'),
    )

    await new ScanWorker(deps).process(
      {
        type: 'CHECK_OSV',
        scanId: 'scan-1',
        chunkIndex: 0,
        packageIds: ['scan-1:package:0'],
      },
      1,
    )

    expect(deps.scans.appendPartialReason).toHaveBeenCalledWith(
      'scan-1',
      'One safety list was not available, so this result may be missing details.',
      '2026-08-06T14:30:00.000Z',
    )
    expect(deps.scans.complete).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ status: 'partial', riskScore: 6, kevCount: 0 }),
    )
  })

  it('shows each skipped-check note only once', async () => {
    const deps = dependencies()
    const packageNote =
      'Some package versions were unclear, so they were not checked.'
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo',
      completedAt: null,
      errorCode: null,
    })
    vi.mocked(deps.osv.checkPackages).mockResolvedValue({
      findings: [],
      partial: true,
      partialReason: packageNote,
      skippedPackageCount: 1,
    })
    vi.mocked(deps.scans.getResult).mockResolvedValue(
      result({
        partial: true,
        partialReason: `10 packages could not be read, so they were not checked. ${packageNote}`,
        findings: [],
        findingCount: 0,
      }),
    )

    await new ScanWorker(deps).process(
      {
        type: 'CHECK_OSV',
        scanId: 'scan-1',
        chunkIndex: 0,
        packageIds: ['scan-1:package:0'],
      },
      1,
    )

    expect(deps.scans.appendPartialReason).toHaveBeenCalledTimes(1)
    expect(deps.scans.complete).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({
        partialReason:
          `10 packages could not be read, so they were not checked. ${packageNote}`,
      }),
    )
  })

  it('retries a temporary OSV failure, then records a final failure', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo',
      completedAt: null,
      errorCode: null,
    })
    vi.mocked(deps.osv.checkPackages).mockRejectedValue(
      new UpstreamError(
        'OSV_UNAVAILABLE',
        'The safety check is not available. Try again later.',
      ),
    )
    const worker = new ScanWorker(deps)
    const message = {
      type: 'CHECK_OSV' as const,
      scanId: 'scan-1',
      chunkIndex: 0,
      packageIds: ['scan-1:package:0'],
    }

    await expect(worker.process(message, 1)).resolves.toEqual({
      action: 'retry',
      delaySeconds: 4,
    })
    await expect(worker.process(message, 3)).resolves.toEqual({ action: 'ack' })
    expect(deps.scans.failChunk).toHaveBeenCalled()
    expect(deps.scans.fail).toHaveBeenCalledWith(
      'scan-1',
      'OSV_UNAVAILABLE',
      'The safety check is not available. Try again later.',
      '2026-08-06T14:30:00.000Z',
    )
  })

  it('stops immediately when GitHub says its limit was reached', async () => {
    const deps = dependencies()
    vi.mocked(deps.github.loadSbom).mockRejectedValue(
      new UpstreamError(
        'GITHUB_RATE_LIMITED',
        'GitHub is busy. Try again in a few minutes.',
      ),
    )

    await expect(
      new ScanWorker(deps).process(
        {
          type: 'FETCH_SBOM',
          scanId: 'scan-1',
          repositoryUrl: 'https://github.com/owner/repo',
        },
        1,
      ),
    ).resolves.toEqual({ action: 'ack' })
    expect(deps.scans.fail).toHaveBeenCalledWith(
      'scan-1',
      'GITHUB_RATE_LIMITED',
      'GitHub is busy. Try again in a few minutes.',
      '2026-08-06T14:30:00.000Z',
    )
  })

  it('stops immediately when OSV says its limit was reached', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.get).mockResolvedValue({
      id: 'scan-1',
      status: 'checking',
      statusMessage: 'Checking packages.',
      repositoryCacheKey: 'owner/repo',
      completedAt: null,
      errorCode: null,
    })
    vi.mocked(deps.osv.checkPackages).mockRejectedValue(
      new UpstreamError(
        'OSV_RATE_LIMITED',
        'The safety check is busy. Try again in a few minutes.',
      ),
    )

    await expect(
      new ScanWorker(deps).process(
        {
          type: 'CHECK_OSV',
          scanId: 'scan-1',
          chunkIndex: 0,
          packageIds: ['scan-1:package:0'],
        },
        1,
      ),
    ).resolves.toEqual({ action: 'ack' })
    expect(deps.scans.fail).toHaveBeenCalledWith(
      'scan-1',
      'OSV_RATE_LIMITED',
      'The safety check is busy. Try again in a few minutes.',
      '2026-08-06T14:30:00.000Z',
    )
  })
})
