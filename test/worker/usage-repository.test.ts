import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import { UsageRepository } from '../../src/server/db/usage-repository'

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM usage_limits').run()
})

describe('UsageRepository', () => {
  it('allows a bucket up to its limit and then rejects it', async () => {
    const usage = new UsageRepository(env.DB)
    const expiresAt = '2026-08-07T00:00:00.000Z'

    await expect(usage.consume('day:2026-08-06', 'global', 2, expiresAt)).resolves.toEqual({
      allowed: true,
      count: 1,
    })
    await expect(usage.consume('day:2026-08-06', 'global', 2, expiresAt)).resolves.toEqual({
      allowed: true,
      count: 2,
    })
    await expect(usage.consume('day:2026-08-06', 'global', 2, expiresAt)).resolves.toEqual({
      allowed: false,
      count: 2,
    })
  })

  it('keeps different client buckets separate', async () => {
    const usage = new UsageRepository(env.DB)

    await usage.consume('hour:2026-08-06T14', 'client-a', 1, '2026-08-06T15:00:00.000Z')

    await expect(
      usage.consume('hour:2026-08-06T14', 'client-b', 1, '2026-08-06T15:00:00.000Z'),
    ).resolves.toEqual({ allowed: true, count: 1 })
  })

  it('removes expired buckets in a bounded cleanup', async () => {
    const usage = new UsageRepository(env.DB)
    await usage.consume('old', 'client', 1, '2026-08-01T00:00:00.000Z')

    await expect(usage.deleteExpired('2026-08-06T00:00:00.000Z', 5)).resolves.toBe(1)
  })
})

