import { describe, expect, it } from 'vitest'

import { calculateRisk } from '../../src/server/domain/risk'

describe('calculateRisk', () => {
  it('uses the approved explainable weights', () => {
    expect(
      calculateRisk([
        { severity: 'critical', isKev: false },
        { severity: 'high', isKev: true },
        { severity: 'medium', isKev: false },
        { severity: 'low', isKev: false },
        { severity: 'unknown', isKev: false },
      ]),
    ).toEqual({
      score: 36,
      kevCount: 1,
      counts: {
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
        unknown: 1,
      },
    })
  })

  it('caps the public score at 100', () => {
    const findings = Array.from({ length: 10 }, () => ({
      severity: 'critical' as const,
      isKev: true,
    }))

    expect(calculateRisk(findings).score).toBe(100)
  })

  it('returns zero counts for an empty scan', () => {
    expect(calculateRisk([])).toEqual({
      score: 0,
      kevCount: 0,
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    })
  })
})

