import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError, requestHealth } from '../../src/client/api'

describe('requestHealth', () => {
  it('reads only the public live-scan status', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          service: 'supplytrace',
          version: 'test',
          liveScansEnabled: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(requestHealth(fetcher)).resolves.toEqual({
      status: 'ok',
      service: 'supplytrace',
      version: 'test',
      liveScansEnabled: false,
    })
    expect(fetcher).toHaveBeenCalledWith('/api/health', {
      headers: { accept: 'application/json' },
    })
  })

  it('fails closed when the health reply is malformed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ liveScansEnabled: 'yes' }), {
        status: 200,
      }),
    )

    await expect(requestHealth(fetcher)).rejects.toEqual(
      new ApiRequestError(
        'UNREADABLE_RESPONSE',
        'We could not read the service status.',
        200,
      ),
    )
  })
})
