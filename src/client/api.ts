import type {
  ApiErrorResponse,
  CreateScanResponse,
  HealthResponse,
  ScanResultResponse,
  ScanStatus,
  Severity,
} from '../shared/contracts'

const scanStatuses = new Set<ScanStatus>([
  'queued',
  'fetching',
  'checking',
  'complete',
  'partial',
  'failed',
])

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function requestHealth(
  fetcher: typeof fetch = fetch,
): Promise<HealthResponse> {
  let response: Response

  try {
    response = await fetcher('/api/health', {
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new ApiRequestError(
      'NETWORK_ERROR',
      'We could not reach SupplyTrace.',
      null,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the service status.',
      response.status,
    )
  }

  if (
    !response.ok ||
    !isRecord(body) ||
    body.status !== 'ok' ||
    body.service !== 'supplytrace' ||
    typeof body.version !== 'string' ||
    typeof body.liveScansEnabled !== 'boolean'
  ) {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the service status.',
      response.status,
    )
  }

  return body as HealthResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readError(value: unknown): ApiErrorResponse['error'] | null {
  if (!isRecord(value) || !isRecord(value.error)) return null
  if (
    typeof value.error.code !== 'string' ||
    typeof value.error.message !== 'string'
  ) {
    return null
  }
  return { code: value.error.code, message: value.error.message }
}

function readCreated(value: unknown): CreateScanResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.scanId !== 'string' ||
    typeof value.status !== 'string' ||
    !scanStatuses.has(value.status as ScanStatus) ||
    typeof value.reused !== 'boolean' ||
    typeof value.resultUrl !== 'string' ||
    !/^\/scans\/[0-9a-f-]{36}$/i.test(value.resultUrl)
  ) {
    return null
  }

  return {
    scanId: value.scanId,
    status: value.status as ScanStatus,
    reused: value.reused,
    resultUrl: value.resultUrl,
  }
}

const severities = new Set<Severity>([
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
])

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function readScanResult(value: unknown): ScanResultResponse | null {
  if (!isRecord(value) || !isRecord(value.repository)) return null

  const packages = value.packages
  const edges = value.edges
  const findings = value.findings
  const counts = value.severityCounts

  if (
    typeof value.scanId !== 'string' ||
    typeof value.status !== 'string' ||
    !scanStatuses.has(value.status as ScanStatus) ||
    typeof value.statusMessage !== 'string' ||
    typeof value.repository.owner !== 'string' ||
    typeof value.repository.repository !== 'string' ||
    typeof value.repository.fullName !== 'string' ||
    typeof value.repository.cacheKey !== 'string' ||
    typeof value.repository.url !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !(typeof value.completedAt === 'string' || value.completedAt === null) ||
    typeof value.expiresAt !== 'string' ||
    typeof value.partial !== 'boolean' ||
    !(typeof value.partialReason === 'string' || value.partialReason === null) ||
    typeof value.riskScore !== 'number' ||
    typeof value.kevCount !== 'number' ||
    !isRecord(counts) ||
    !['critical', 'high', 'medium', 'low', 'unknown'].every(
      (key) => typeof counts[key] === 'number',
    ) ||
    typeof value.packageCount !== 'number' ||
    typeof value.vulnerablePackageCount !== 'number' ||
    typeof value.findingCount !== 'number' ||
    !Array.isArray(packages) ||
    !Array.isArray(edges) ||
    !Array.isArray(findings)
  ) {
    return null
  }

  const validPackages = packages.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.spdxId === 'string' &&
      typeof item.ecosystem === 'string' &&
      typeof item.name === 'string' &&
      (typeof item.version === 'string' || item.version === null) &&
      typeof item.purl === 'string' &&
      typeof item.direct === 'boolean' &&
      typeof item.vulnerabilityCount === 'number',
  )
  const validEdges = edges.every(
    (item) =>
      isRecord(item) &&
      typeof item.sourceSpdxId === 'string' &&
      typeof item.targetSpdxId === 'string' &&
      typeof item.relationship === 'string',
  )
  const validFindings = findings.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.packageId === 'string' &&
      typeof item.osvId === 'string' &&
      typeof item.severity === 'string' &&
      severities.has(item.severity as Severity) &&
      typeof item.summary === 'string' &&
      isStringArray(item.aliases) &&
      isStringArray(item.fixedVersions) &&
      isStringArray(item.evidenceUrls) &&
      typeof item.isKev === 'boolean' &&
      (typeof item.kevDueDate === 'string' || item.kevDueDate === null) &&
      (typeof item.knownRansomwareUse === 'boolean' ||
        item.knownRansomwareUse === null),
  )

  return validPackages && validEdges && validFindings
    ? (value as unknown as ScanResultResponse)
    : null
}

export async function requestScan(
  repositoryUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<CreateScanResponse> {
  let response: Response

  try {
    response = await fetcher('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryUrl }),
    })
  } catch {
    throw new ApiRequestError(
      'NETWORK_ERROR',
      'We could not reach SupplyTrace. Check your connection and try again.',
      null,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the reply. Try again in a few minutes.',
      response.status,
    )
  }

  if (!response.ok) {
    const error = readError(body)
    throw new ApiRequestError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'We could not start the check. Try again in a few minutes.',
      response.status,
    )
  }

  const created = readCreated(body)
  if (!created) {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the reply. Try again in a few minutes.',
      response.status,
    )
  }

  return created
}

export async function requestScanResult(
  scanId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ScanResultResponse> {
  let response: Response

  try {
    response = await fetcher(`/api/scans/${encodeURIComponent(scanId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError(
      'NETWORK_ERROR',
      'We could not reach SupplyTrace. Check your connection and try again.',
      null,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the reply. Try again in a few minutes.',
      response.status,
    )
  }

  if (!response.ok) {
    const error = readError(body)
    throw new ApiRequestError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'We could not load this check. Try again in a few minutes.',
      response.status,
    )
  }

  const result = readScanResult(body)
  if (!result) {
    throw new ApiRequestError(
      'UNREADABLE_RESPONSE',
      'We could not read the reply. Try again in a few minutes.',
      response.status,
    )
  }

  return result
}
