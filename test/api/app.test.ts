import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../../src/server/api/app'
import type { AppEnv } from '../../src/server/services/dependencies'
import { RepositoryUrlError } from '../../src/server/domain/repository-url'
import { ServiceError } from '../../src/server/services/scan-service'
import type {
  CreateScanResponse,
  ScanResultResponse,
} from '../../src/shared/contracts'

const scanId = '11111111-1111-4111-8111-111111111111'
const env = {
  APP_VERSION: 'test',
  GITHUB_TOKEN: 'local-test-token',
} as AppEnv
const queued: CreateScanResponse = {
  scanId,
  status: 'queued',
  reused: false,
  resultUrl: `/scans/${scanId}`,
}
const result: ScanResultResponse = {
  scanId,
  status: 'checking',
  statusMessage: 'Checking the packages for known problems.',
  repository: {
    owner: 'cloudflare',
    repository: 'workers-sdk',
    fullName: 'cloudflare/workers-sdk',
    cacheKey: 'cloudflare/workers-sdk',
    url: 'https://github.com/cloudflare/workers-sdk',
  },
  createdAt: '2026-08-06T15:00:00.000Z',
  completedAt: null,
  expiresAt: '2026-09-05T15:00:00.000Z',
  partial: false,
  partialReason: null,
  riskScore: 0,
  kevCount: 0,
  severityCounts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
  packageCount: 0,
  vulnerablePackageCount: 0,
  findingCount: 0,
  packages: [],
  edges: [],
  findings: [],
}

describe('SupplyTrace API', () => {
  const createScan = vi.fn()
  const getResult = vi.fn()
  const app = createApp({
    scanService: () => ({ createScan }),
    scanResults: () => ({ getResult }),
  })

  beforeEach(() => {
    createScan.mockReset()
    getResult.mockReset()
  })

  it('returns health data and strict browser headers', async () => {
    const response = await app.request('/api/health', {}, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'supplytrace',
      version: 'test',
      liveScansEnabled: true,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    )
  })

  it('reports when live scans are off without revealing a credential', async () => {
    const response = await app.request(
      '/api/health',
      {},
      { ...env, GITHUB_TOKEN: undefined },
    )

    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'supplytrace',
      version: 'test',
      liveScansEnabled: false,
    })
  })

  it('blocks public scans before reading or processing the request', async () => {
    const response = await app.request(
      'https://supplytrace.example/api/scans',
      {
        method: 'POST',
        headers: { origin: 'https://other.example' },
        body: 'not json',
      },
      { ...env, GITHUB_TOKEN: undefined },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'LIVE_SCANS_DISABLED',
        message:
          'Live checks are off on this public demo. Run SupplyTrace on your computer with your own GitHub key.',
      },
    })
    expect(createScan).not.toHaveBeenCalled()
  })

  it('starts a new scan and returns its result link', async () => {
    createScan.mockResolvedValue(queued)

    const response = await app.request(
      '/api/scans',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.42',
        },
        body: JSON.stringify({
          repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
          ignored: 'safe to ignore',
        }),
      },
      env,
    )

    expect(response.status).toBe(202)
    expect(response.headers.get('location')).toBe(`/scans/${scanId}`)
    await expect(response.json()).resolves.toEqual(queued)
    expect(createScan).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
      clientAddress: '203.0.113.42',
    })
  })

  it('returns a reused scan without creating a new job', async () => {
    createScan.mockResolvedValue({ ...queued, status: 'complete', reused: true })

    const response = await postScan(app, 'https://github.com/cloudflare/workers-sdk')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      scanId,
      status: 'complete',
      reused: true,
    })
  })

  it('returns progress and completed results using the same shape', async () => {
    getResult
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({
        ...result,
        status: 'complete',
        statusMessage: 'Scan complete.',
        completedAt: '2026-08-06T15:01:00.000Z',
        riskScore: 6,
      })

    const progress = await app.request(`/api/scans/${scanId}`, {}, env)
    const complete = await app.request(`/api/scans/${scanId}`, {}, env)

    expect(progress.status).toBe(200)
    await expect(progress.json()).resolves.toMatchObject({
      scanId,
      status: 'checking',
      packages: [],
      findings: [],
    })
    await expect(complete.json()).resolves.toMatchObject({
      scanId,
      status: 'complete',
      riskScore: 6,
    })
  })

  it('returns a simple not-found error for a missing scan', async () => {
    getResult.mockResolvedValue(null)

    const response = await app.request(`/api/scans/${scanId}`, {}, env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SCAN_NOT_FOUND',
        message: 'We could not find that check.',
      },
    })
  })

  it('rejects requests that are not JSON', async () => {
    const response = await app.request(
      '/api/scans',
      { method: 'POST', body: 'not json' },
      env,
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE' },
    })
  })

  it('rejects broken JSON and missing project links', async () => {
    const broken = await app.request(
      '/api/scans',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
      env,
    )
    const missing = await app.request(
      '/api/scans',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      env,
    )

    expect(broken.status).toBe(400)
    await expect(broken.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON' },
    })
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Enter a public GitHub project link.',
      },
    })
    expect(createScan).not.toHaveBeenCalled()
  })

  it('rejects a request body larger than one kilobyte', async () => {
    const response = await app.request(
      '/api/scans',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: `https://github.com/${'a'.repeat(1100)}` }),
      },
      env,
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'REQUEST_TOO_LARGE' },
    })
    expect(createScan).not.toHaveBeenCalled()
  })

  it('maps invalid links and free-use limits to public errors', async () => {
    createScan
      .mockRejectedValueOnce(new RepositoryUrlError())
      .mockRejectedValueOnce(
        new ServiceError(
          'HOURLY_LIMIT_REACHED',
          'You have used all your checks for this hour. Try again next hour.',
          429,
        ),
      )

    const invalid = await postScan(app, 'not-a-link')
    const limited = await postScan(app, 'https://github.com/cloudflare/workers-sdk')

    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REPOSITORY_URL' },
    })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: 'HOURLY_LIMIT_REACHED' },
    })
  })

  it('blocks scan requests sent from another website', async () => {
    const response = await app.request(
      'https://supplytrace.example/api/scans',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://other.example',
        },
        body: JSON.stringify({
          repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
        }),
      },
      env,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CROSS_SITE_REQUEST' },
    })
    expect(createScan).not.toHaveBeenCalled()
  })

  it('never returns private details from an unexpected error', async () => {
    createScan.mockRejectedValue(new Error('secret database detail'))

    const response = await postScan(app, 'https://github.com/cloudflare/workers-sdk')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).toContain('INTERNAL_ERROR')
    expect(body).not.toContain('secret database detail')
  })

  it('uses the standard error shape for unknown API routes', async () => {
    const response = await app.request('/api/missing', {}, env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'API_NOT_FOUND' },
    })
  })
})

function postScan(
  app: ReturnType<typeof createApp>,
  repositoryUrl: string,
): Promise<Response> {
  return app.request(
    '/api/scans',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryUrl }),
    },
    env,
  )
}
