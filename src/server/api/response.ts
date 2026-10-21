import { ApiError } from './errors'

const MAX_REQUEST_BYTES = 1024
const SCAN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

function tooLarge(): ApiError {
  return new ApiError('REQUEST_TOO_LARGE', 'The request is too large.', 413)
}

export function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders)
  headers.set('content-type', 'application/json; charset=UTF-8')

  for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, headerValue)
  }

  return new Response(JSON.stringify(value), { status, headers })
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (mediaType !== 'application/json') {
    throw new ApiError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Send the request as JSON.',
      415,
    )
  }

  const encoding = request.headers.get('content-encoding')?.trim().toLowerCase()
  if (encoding && encoding !== 'identity') {
    throw new ApiError('UNSUPPORTED_BODY', 'Send plain JSON.', 415)
  }

  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_REQUEST_BYTES
  ) {
    throw tooLarge()
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ApiError('INVALID_JSON', 'We could not read that request.', 400)
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('INVALID_REQUEST', 'Enter a public GitHub project link.', 400)
  }

  return value as Record<string, unknown>
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  const requestOrigin = new URL(request.url).origin

  if (fetchSite === 'cross-site' || (origin !== null && origin !== requestOrigin)) {
    throw new ApiError(
      'CROSS_SITE_REQUEST',
      'Start the check from the SupplyTrace website.',
      403,
    )
  }
}

export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim().slice(0, 64) || 'unknown'
}

export function isScanId(value: string): boolean {
  return SCAN_ID_PATTERN.test(value)
}
