import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HomePage } from '../../src/client/pages/HomePage'
import type { CreateScanResponse } from '../../src/shared/contracts'

const created: CreateScanResponse = {
  scanId: '11111111-1111-4111-8111-111111111111',
  status: 'queued',
  reused: false,
  resultUrl: '/scans/11111111-1111-4111-8111-111111111111',
}

describe('HomePage', () => {
  const scanRequest = vi.fn<
    (repositoryUrl: string) => Promise<CreateScanResponse>
  >()
  const onNavigate = vi.fn<(path: string) => void>()

  beforeEach(() => {
    scanRequest.mockReset()
    onNavigate.mockReset()
  })

  afterEach(cleanup)

  it('explains the scanner with short, clear wording', () => {
    render(
      <HomePage
        liveScansEnabled
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Find known problems in a GitHub project.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Free to use')).toBeInTheDocument()
    expect(screen.getByText('No sign-in')).toBeInTheDocument()
    expect(screen.getByLabelText('GitHub project link')).toBeInTheDocument()
  })

  it('shows only a safe example when live scans are off', () => {
    render(
      <HomePage
        liveScansEnabled={false}
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.queryByLabelText('GitHub project link')).not.toBeInTheDocument()
    expect(
      screen.getByText('Live checks are off on this public demo.'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'View example result' }),
    ).toHaveLength(2)
    for (const link of screen.getAllByRole('link', { name: 'View example result' })) {
      expect(link).toHaveAttribute('href', '/example')
    }
    expect(scanRequest).not.toHaveBeenCalled()
  })

  it('shows a nearby error and focuses an invalid field', async () => {
    const user = userEvent.setup()
    render(
      <HomePage
        liveScansEnabled
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )
    const input = screen.getByLabelText('GitHub project link')

    await user.type(input, 'not-a-link')
    await user.click(screen.getByRole('button', { name: 'Check project' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a public GitHub project link.',
    )
    expect(input).toHaveFocus()
    expect(scanRequest).not.toHaveBeenCalled()
  })

  it('shows a busy state and opens the result after a valid submit', async () => {
    const user = userEvent.setup()
    let finish: (value: CreateScanResponse) => void = () => undefined
    scanRequest.mockReturnValue(
      new Promise<CreateScanResponse>((resolve) => {
        finish = resolve
      }),
    )
    render(
      <HomePage
        liveScansEnabled
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )

    await user.type(
      screen.getByLabelText('GitHub project link'),
      '  https://github.com/cloudflare/workers-sdk  ',
    )
    await user.click(screen.getByRole('button', { name: 'Check project' }))

    expect(screen.getByRole('button', { name: 'Starting check' })).toBeDisabled()
    expect(scanRequest).toHaveBeenCalledWith(
      'https://github.com/cloudflare/workers-sdk',
    )

    await act(async () => finish(created))

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(created.resultUrl))
  })

  it('submits with the Enter key', async () => {
    const user = userEvent.setup()
    scanRequest.mockResolvedValue(created)
    render(
      <HomePage
        liveScansEnabled
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )

    const input = screen.getByLabelText('GitHub project link')
    await user.type(input, 'https://github.com/expressjs/express{Enter}')

    await waitFor(() =>
      expect(scanRequest).toHaveBeenCalledWith(
        'https://github.com/expressjs/express',
      ),
    )
    expect(onNavigate).toHaveBeenCalledWith(created.resultUrl)
  })

  it('shows a simple API error and lets the user try again', async () => {
    const user = userEvent.setup()
    scanRequest.mockRejectedValue(
      new Error('GitHub is busy. Try again in a few minutes.'),
    )
    render(
      <HomePage
        liveScansEnabled
        scanRequest={scanRequest}
        onNavigate={onNavigate}
      />,
    )

    const input = screen.getByLabelText('GitHub project link')
    await user.type(input, 'https://github.com/expressjs/express')
    await user.click(screen.getByRole('button', { name: 'Check project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub is busy. Try again in a few minutes.',
    )
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Check project' })).toBeEnabled()
  })
})
