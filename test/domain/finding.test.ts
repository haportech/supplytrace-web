import { describe, expect, it } from 'vitest'

import {
  extractFixedVersions,
  normalizeSeverity,
} from '../../src/server/domain/finding'

describe('normalizeSeverity', () => {
  it.each([
    ['CRITICAL', 'critical'],
    ['High', 'high'],
    ['moderate', 'medium'],
    ['LOW', 'low'],
    [9, 'critical'],
    ['8.1', 'high'],
    [6.4, 'medium'],
    [2.9, 'low'],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 'unknown'],
    [undefined, 'unknown'],
  ])('maps %s to %s', (value, expected) => {
    expect(normalizeSeverity(value)).toBe(expected)
  })
})

describe('extractFixedVersions', () => {
  const affected = [
    {
      package: { ecosystem: 'npm', name: 'example' },
      ranges: [
        {
          events: [
            { introduced: '0' },
            { fixed: '1.2.3' },
            { fixed: '1.2.3' },
            { fixed: '2.0.1' },
          ],
        },
      ],
    },
    {
      package: { ecosystem: 'npm', name: 'different' },
      ranges: [{ events: [{ fixed: '9.9.9' }] }],
    },
  ]

  it('returns unique fixed versions for the matching package', () => {
    expect(
      extractFixedVersions(affected, { ecosystem: 'npm', name: 'example' }),
    ).toEqual(['1.2.3', '2.0.1'])
  })

  it('returns an empty list when OSV lists no matching fix', () => {
    expect(
      extractFixedVersions(affected, { ecosystem: 'PyPI', name: 'example' }),
    ).toEqual([])
  })
})

