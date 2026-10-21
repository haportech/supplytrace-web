import type { Severity } from '../shared/contracts'

export function dangerLabel(severity: Severity): string {
  if (severity === 'critical') return 'Very high'
  if (severity === 'unknown') return 'Not rated'
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}
