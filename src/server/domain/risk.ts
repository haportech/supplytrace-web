import {
  severityLevels,
  type Severity,
  type SeverityCounts,
} from '../../shared/contracts'

type RiskFinding = {
  severity: Severity
  isKev: boolean
}

const WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
  unknown: 1,
}

export function calculateRisk(findings: RiskFinding[]): {
  score: number
  kevCount: number
  counts: SeverityCounts
} {
  const counts = Object.fromEntries(
    severityLevels.map((severity) => [severity, 0]),
  ) as SeverityCounts
  let score = 0
  let kevCount = 0

  for (const finding of findings) {
    counts[finding.severity] += 1
    score += WEIGHTS[finding.severity]

    if (finding.isKev) {
      kevCount += 1
      score += 15
    }
  }

  return {
    score: Math.min(score, 100),
    kevCount,
    counts,
  }
}

