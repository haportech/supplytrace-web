import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FindingsTable } from '../../src/client/components/FindingsTable'
import { scanResult } from '../helpers/scan-result'

afterEach(cleanup)

describe('FindingsTable', () => {
  it('filters problems by danger and selects one with a real button', async () => {
    const user = userEvent.setup()
    const result = scanResult()
    const onSelect = vi.fn()

    render(
      <FindingsTable
        findings={result.findings}
        packages={result.packages}
        selectedId={null}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('GHSA-test-one')).toBeInTheDocument()
    expect(screen.getByText('GHSA-test-two')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show very high only' }))

    expect(screen.getByText('GHSA-test-one')).toBeInTheDocument()
    expect(screen.queryByText('GHSA-test-two')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open GHSA-test-one/i }))
    expect(onSelect).toHaveBeenCalledWith(result.findings[0])
  })

  it('shows when no safer version was listed', () => {
    const result = scanResult()

    render(
      <FindingsTable
        findings={[result.findings[1]]}
        packages={result.packages}
        selectedId={null}
        onSelect={() => undefined}
      />,
    )

    expect(screen.getByText('No safer version listed')).toBeInTheDocument()
  })

  it('shows 100 problems at a time and resets after filtering', async () => {
    const user = userEvent.setup()
    const result = scanResult()
    const manyFindings = Array.from({ length: 101 }, (_, index) => ({
      ...result.findings[0],
      id: `finding-page-${index + 1}`,
      osvId: `GHSA-page-${index + 1}`,
      severity: 'high' as const,
    }))

    render(
      <FindingsTable
        findings={manyFindings}
        packages={result.packages}
        selectedId={null}
        onSelect={() => undefined}
      />,
    )

    expect(screen.getByText('GHSA-page-1')).toBeInTheDocument()
    expect(screen.queryByText('GHSA-page-101')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('GHSA-page-101')).toBeInTheDocument()
    expect(screen.queryByText('GHSA-page-1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show high only' }))
    expect(screen.getByText('GHSA-page-1')).toBeInTheDocument()
    expect(screen.queryByText('GHSA-page-101')).not.toBeInTheDocument()
  })
})
