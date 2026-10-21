import { describe, expect, it, vi } from 'vitest'

import {
  ScanService,
  ServiceError,
  type ScanServiceDependencies,
} from '../../src/server/services/scan-service'

function dependencies(): ScanServiceDependencies {
  return {
    scans: {
      deleteExpired: vi.fn().mockResolvedValue(0),
      findFreshByRepository: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    },
    usage: {
      deleteExpired: vi.fn().mockResolvedValue(0),
      consume: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    },
    queue: {
      send: vi.fn().mockResolvedValue(undefined),
      sendBatch: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date('2026-08-06T14:30:00.000Z'),
    newId: () => 'scan-123',
    hashClient: vi.fn().mockResolvedValue('anonymous-hash'),
    fullScan: false,
    limits: {
      daily: 20,
      hourly: 3,
      cacheHours: 6,
      retentionDays: 30,
    },
  }
}

describe('ScanService', () => {
  it('creates a queued scan after consuming free-use limits', async () => {
    const deps = dependencies()
    const service = new ScanService(deps)

    await expect(
      service.createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).resolves.toEqual({
      scanId: 'scan-123',
      status: 'queued',
      reused: false,
      resultUrl: '/scans/scan-123',
    })

    expect(deps.hashClient).toHaveBeenCalledWith('203.0.113.10')
    expect(deps.usage.consume).toHaveBeenNthCalledWith(
      1,
      'hour:2026-08-06T14',
      'anonymous-hash',
      3,
      '2026-08-06T15:00:00.000Z',
    )
    expect(deps.usage.consume).toHaveBeenNthCalledWith(
      2,
      'day:2026-08-06',
      'global',
      20,
      '2026-08-07T00:00:00.000Z',
    )
    expect(deps.scans.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'scan-123',
        expiresAt: '2026-09-05T14:30:00.000Z',
      }),
    )
    expect(deps.queue.send).toHaveBeenCalledWith({
      type: 'FETCH_SBOM',
      scanId: 'scan-123',
      repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
    })
  })

  it('reuses a fresh result without consuming another limit', async () => {
    const deps = dependencies()
    vi.mocked(deps.scans.findFreshByRepository).mockResolvedValue({
      id: 'scan-reused',
      status: 'complete',
      statusMessage: 'Scan complete.',
      repositoryCacheKey: 'cloudflare/workers-sdk',
      completedAt: '2026-08-06T14:00:00.000Z',
      errorCode: null,
    })

    await expect(
      new ScanService(deps).createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).resolves.toEqual({
      scanId: 'scan-reused',
      status: 'complete',
      reused: true,
      resultUrl: '/scans/scan-reused',
    })
    expect(deps.usage.consume).not.toHaveBeenCalled()
    expect(deps.queue.send).not.toHaveBeenCalled()
  })

  it('bypasses usage counters and separates full-scan cache entries', async () => {
    const deps = dependencies()
    deps.fullScan = true

    await expect(
      new ScanService(deps).createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).resolves.toMatchObject({
      scanId: 'scan-123',
      status: 'queued',
      reused: false,
    })

    expect(deps.usage.consume).not.toHaveBeenCalled()
    expect(deps.hashClient).not.toHaveBeenCalled()
    expect(deps.scans.findFreshByRepository).toHaveBeenCalledWith(
      'cloudflare/workers-sdk:full',
      '2026-08-06T08:30:00.000Z',
    )
    expect(deps.scans.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: expect.objectContaining({
          cacheKey: 'cloudflare/workers-sdk:full',
        }),
      }),
    )
  })

  it('stops a client that has used its hourly free limit', async () => {
    const deps = dependencies()
    vi.mocked(deps.usage.consume).mockResolvedValueOnce({ allowed: false, count: 3 })

    await expect(
      new ScanService(deps).createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).rejects.toMatchObject<Partial<ServiceError>>({
      code: 'HOURLY_LIMIT_REACHED',
      status: 429,
    })
    expect(deps.scans.create).not.toHaveBeenCalled()
  })

  it('stops all new work when the daily free limit is full', async () => {
    const deps = dependencies()
    vi.mocked(deps.usage.consume)
      .mockResolvedValueOnce({ allowed: true, count: 1 })
      .mockResolvedValueOnce({ allowed: false, count: 20 })

    await expect(
      new ScanService(deps).createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).rejects.toMatchObject<Partial<ServiceError>>({
      code: 'DAILY_LIMIT_REACHED',
      status: 429,
    })
  })

  it('marks the scan failed when queue submission fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.queue.send).mockRejectedValue(new Error('queue unavailable'))

    await expect(
      new ScanService(deps).createScan({
        repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        clientAddress: '203.0.113.10',
      }),
    ).rejects.toMatchObject<Partial<ServiceError>>({
      code: 'QUEUE_UNAVAILABLE',
      status: 503,
    })
    expect(deps.scans.fail).toHaveBeenCalledWith(
      'scan-123',
      'QUEUE_UNAVAILABLE',
      'We could not start the check. Try again in a few minutes.',
      '2026-08-06T14:30:00.000Z',
    )
  })
})
