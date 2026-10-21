type ErrorDescription = {
  code: string
  message: string
}

type RequestOptions = {
  service: string
  maxBytes: number
  timeoutMs: number
  unavailableMessage?: string
  statusCodes?: Record<number, ErrorDescription>
}

export class UpstreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UpstreamError(
      'RESPONSE_TOO_LARGE',
      'The data source returned too much data.',
      response.status,
    )
  }

  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel()
      throw new UpstreamError(
        'RESPONSE_TOO_LARGE',
        'The data source returned too much data.',
        response.status,
      )
    }

    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export class JsonHttpClient {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async request<T = unknown>(
    input: RequestInfo | URL,
    init: RequestInit,
    options: RequestOptions,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    let response: Response

    try {
      response = await this.fetcher(input, { ...init, signal: controller.signal })
    } catch {
      clearTimeout(timeout)
      throw new UpstreamError(
        `${options.service}_UNAVAILABLE`,
        options.unavailableMessage ?? 'A data source is unavailable. Try again later.',
      )
    }

    if (!response.ok) {
      clearTimeout(timeout)
      const mapped = options.statusCodes?.[response.status]
      throw new UpstreamError(
        mapped?.code ?? `${options.service}_UNAVAILABLE`,
        mapped?.message ??
          options.unavailableMessage ??
          'A data source is unavailable. Try again later.',
        response.status,
      )
    }

    let body: Uint8Array

    try {
      body = await readLimitedBody(response, options.maxBytes)
    } catch (error) {
      if (error instanceof UpstreamError && error.code === 'RESPONSE_TOO_LARGE') {
        throw new UpstreamError(
          `${options.service}_RESPONSE_TOO_LARGE`,
          'This project is too large for the free public scanner.',
          response.status,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    try {
      return JSON.parse(new TextDecoder().decode(body)) as T
    } catch {
      throw new UpstreamError(
        `${options.service}_INVALID_RESPONSE`,
        'A data source returned an unreadable response. Try again later.',
        response.status,
      )
    }
  }
}

export function safeHttpsUrls(values: unknown[], limit = 6): string[] {
  const urls = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string') continue

    try {
      const url = new URL(value)
      if (url.protocol !== 'https:') continue
      urls.add(url.toString())
      if (urls.size >= limit) break
    } catch {
      continue
    }
  }

  return [...urls]
}
