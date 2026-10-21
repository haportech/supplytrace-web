export const severityLevels = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
] as const

export type Severity = (typeof severityLevels)[number]

export type ScanStatus =
  | 'queued'
  | 'fetching'
  | 'checking'
  | 'complete'
  | 'partial'
  | 'failed'

export type RepositoryReference = {
  owner: string
  repository: string
  fullName: string
  cacheKey: string
  url: string
}

export type PackageIdentity = {
  ecosystem: string
  name: string
  version: string | null
  purl: string
}

export type SeverityCounts = Record<Severity, number>

export type ApiErrorResponse = {
  error: {
    code: string
    message: string
  }
}

export type HealthResponse = {
  status: 'ok'
  service: 'supplytrace'
  version: string
  liveScansEnabled: boolean
}

export type CreateScanRequest = {
  repositoryUrl: string
}

export type CreateScanResponse = {
  scanId: string
  status: ScanStatus
  reused: boolean
  resultUrl: string
}

export type ScanPackage = PackageIdentity & {
  id: string
  spdxId: string
  direct: boolean
  vulnerabilityCount: number
}

export type DependencyEdge = {
  sourceSpdxId: string
  targetSpdxId: string
  relationship: string
}

export type ScanFinding = {
  id: string
  packageId: string
  osvId: string
  severity: Severity
  summary: string
  aliases: string[]
  fixedVersions: string[]
  evidenceUrls: string[]
  isKev: boolean
  kevDueDate: string | null
  knownRansomwareUse: boolean | null
}

export type ScanResultResponse = {
  scanId: string
  status: ScanStatus
  statusMessage: string
  repository: RepositoryReference
  createdAt: string
  completedAt: string | null
  expiresAt: string
  partial: boolean
  partialReason: string | null
  riskScore: number
  kevCount: number
  severityCounts: SeverityCounts
  packageCount: number
  vulnerablePackageCount: number
  findingCount: number
  packages: ScanPackage[]
  edges: DependencyEdge[]
  findings: ScanFinding[]
}
