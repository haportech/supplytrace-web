import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TablePager } from '../../src/client/components/TablePager'

afterEach(cleanup)

describe('TablePager', () => {
  it('moves between pages and disables buttons at each end', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const { rerender } = render(
      <TablePager
        label="Problems"
        page={1}
        pageCount={3}
        onPageChange={onPageChange}
      />,
    )

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(
      <TablePager
        label="Problems"
        page={3}
        pageCount={3}
        onPageChange={onPageChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('stays hidden when every row fits on one page', () => {
    render(
      <TablePager
        label="Problems"
        page={1}
        pageCount={1}
        onPageChange={() => undefined}
      />,
    )

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
