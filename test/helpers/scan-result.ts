import type { ScanResultResponse } from '../../src/shared/contracts'
import { exampleResult } from '../../src/shared/example-result'

export function scanResult(
  overrides: Partial<ScanResultResponse> = {},
): ScanResultResponse {
  return {
    ...exampleResult,
    ...overrides,
  }
}
