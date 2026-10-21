export type FetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
}

type QueuedResponse = Response | ((call: FetchCall) => Response | Promise<Response>)

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

export function createFetchQueue(responses: QueuedResponse[]): {
  fetcher: typeof fetch
  calls: FetchCall[]
} {
  const queue = [...responses]
  const calls: FetchCall[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { input, init }
    calls.push(call)
    const response = queue.shift()

    if (!response) throw new Error('Unexpected fetch call')

    return typeof response === 'function' ? response(call) : response
  }) as typeof fetch

  return { fetcher, calls }
}

