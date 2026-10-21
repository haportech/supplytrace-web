import type { PackageIdentity, Severity } from '../../shared/contracts'

type OsvRangeLike = {
  events?: Array<{ fixed?: unknown }>
}

export type OsvAffectedLike = {
  package?: {
    ecosystem?: unknown
    name?: unknown
  }
  ranges?: OsvRangeLike[]
}

const LABELS: Record<string, Severity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  moderate: 'medium',
  low: 'low',
  unknown: 'unknown',
}

function scoreSeverity(score: number): Severity {
  if (!Number.isFinite(score) || score <= 0 || score > 10) return 'unknown'
  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

export function normalizeSeverity(...values: unknown[]): Severity {
  for (const value of values) {
    if (typeof value === 'number') {
      const severity = scoreSeverity(value)
      if (severity !== 'unknown') return severity
      continue
    }

    if (typeof value !== 'string') continue

    const normalized = value.trim().toLowerCase()
    const label = LABELS[normalized]
    if (label) return label

    if (/^\d+(?:\.\d+)?$/.test(normalized)) {
      const severity = scoreSeverity(Number(normalized))
      if (severity !== 'unknown') return severity
    }
  }

  return 'unknown'
}

export function extractFixedVersions(
  affected: OsvAffectedLike[] | undefined,
  identity: Pick<PackageIdentity, 'ecosystem' | 'name'>,
): string[] {
  const fixes = new Set<string>()
  const targetEcosystem = identity.ecosystem.toLowerCase()
  const targetName = identity.name.toLowerCase()

  for (const item of affected ?? []) {
    const ecosystem =
      typeof item.package?.ecosystem === 'string'
        ? item.package.ecosystem.toLowerCase()
        : ''
    const name =
      typeof item.package?.name === 'string' ? item.package.name.toLowerCase() : ''

    if (ecosystem !== targetEcosystem || name !== targetName) continue

    for (const range of item.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (typeof event.fixed === 'string' && event.fixed.trim().length > 0) {
          fixes.add(event.fixed.trim())
        }
      }
    }
  }

  return [...fixes]
}

