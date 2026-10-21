import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { DependencyTable } from '../../src/client/components/DependencyTable'
import { scanResult } from '../helpers/scan-result'

afterEach(cleanup)

describe('DependencyTable', () => {
  it('shows 100 package links at a time', async () => {
    const user = userEvent.setup()
    const result = scanResult()
    const edges = Array.from({ length: 101 }, (_, index) => ({
      sourceSpdxId: 'SPDXRef-DOCUMENT',
      targetSpdxId: `SPDXRef-Package-${index + 1}`,
      relationship: 'DEPENDS_ON',
    }))

    render(<DependencyTable packages={result.packages} edges={edges} />)

    expect(screen.getByText('SPDXRef-Package-1')).toBeInTheDocument()
    expect(screen.queryByText('SPDXRef-Package-101')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('SPDXRef-Package-101')).toBeInTheDocument()
    expect(screen.queryByText('SPDXRef-Package-1')).not.toBeInTheDocument()
  })
})
