import { describe, expect, it } from 'vitest'

import { JsonHttpClient, UpstreamError } from '../../src/server/clients/http'
import { createFetchQueue, jsonResponse } from '../helpers/fetch'

describe('JsonHttpClient', () => {
  it('returns parsed JSON within the body limit', async () => {
    const { fetcher } = createFetchQueue([jsonResponse({ ok: true })])
    const client = new JsonHttpClient(fetcher)

    await expect(
      client.request('https://example.com/data', {}, {
        service: 'TEST',
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ ok: true })
  })

  it('rejects a declared oversized response without reading it', async () => {
    const { fetcher } = createFetchQueue([
      new Response('{}', { headers: { 'content-length': '2048' } }),
    ])
    const client = new JsonHttpClient(fetcher)

    await expect(
      client.request('https://example.com/data', {}, {
        service: 'TEST',
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject<Partial<UpstreamError>>({
      code: 'TEST_RESPONSE_TOO_LARGE',
    })
  })

  it('rejects malformed JSON with a public error code', async () => {
    const { fetcher } = createFetchQueue([new Response('{broken')])
    const client = new JsonHttpClient(fetcher)

    await expect(
      client.request('https://example.com/data', {}, {
        service: 'TEST',
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject<Partial<UpstreamError>>({
      code: 'TEST_INVALID_RESPONSE',
    })
  })

  it('maps status errors without returning the upstream body', async () => {
    const { fetcher } = createFetchQueue([
      new Response('private upstream detail', { status: 429 }),
    ])
    const client = new JsonHttpClient(fetcher)

    await expect(
      client.request('https://example.com/data', {}, {
        service: 'TEST',
        maxBytes: 1024,
        timeoutMs: 100,
        statusCodes: {
          429: {
            code: 'TEST_RATE_LIMITED',
            message: 'Try again later.',
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'TEST_RATE_LIMITED',
      message: 'Try again later.',
      status: 429,
    })
  })

  it('aborts a request that exceeds its time limit', async () => {
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Timed out', 'AbortError')),
        )
      })) as typeof fetch
    const client = new JsonHttpClient(fetcher)

    await expect(
      client.request('https://example.com/data', {}, {
        service: 'TEST',
        maxBytes: 1024,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'TEST_UNAVAILABLE' })
  })
})
