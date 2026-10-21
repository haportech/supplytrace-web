import { describe, expect, it } from 'vitest'

import { localFullScanEnabled } from '../../src/server/services/dependencies'

describe('localFullScanEnabled', () => {
  it('requires the local flag and a GitHub token', () => {
    expect(
      localFullScanEnabled({
        GITHUB_TOKEN: 'key',
        LOCAL_FULL_SCAN: 'true',
      }),
    ).toBe(true)
    expect(
      localFullScanEnabled({
        GITHUB_TOKEN: undefined,
        LOCAL_FULL_SCAN: 'true',
      }),
    ).toBe(false)
    expect(
      localFullScanEnabled({
        GITHUB_TOKEN: 'key',
        LOCAL_FULL_SCAN: undefined,
      }),
    ).toBe(false)
    expect(
      localFullScanEnabled({
        GITHUB_TOKEN: 'key',
        LOCAL_FULL_SCAN: 'false',
      }),
    ).toBe(false)
  })
})
