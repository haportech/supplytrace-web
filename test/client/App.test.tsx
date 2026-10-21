import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App'

describe('App', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('fails closed to the public demo', async () => {
    render(
      <App
        loadHealth={async () => ({
          status: 'ok',
          service: 'supplytrace',
          version: 'test',
          liveScansEnabled: false,
        })}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: 'Find known problems in a GitHub project.',
      }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Live checks are off on this public demo.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub project link')).not.toBeInTheDocument()
  })

  it('shows the local form only when health enables live scans', async () => {
    render(
      <App
        loadHealth={async () => ({
          status: 'ok',
          service: 'supplytrace',
          version: 'test',
          liveScansEnabled: true,
        })}
      />,
    )

    expect(await screen.findByLabelText('GitHub project link')).toBeInTheDocument()
  })

  it('shows the built-in example without calling the scan API', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const loadHealth = vi.fn().mockResolvedValue({
      status: 'ok' as const,
      service: 'supplytrace' as const,
      version: 'test',
      liveScansEnabled: false,
    })
    vi.stubGlobal('fetch', fetcher)
    window.history.replaceState(null, '', '/example')

    render(
      <App loadHealth={loadHealth} />,
    )

    expect(
      await screen.findByText('Example result — no live check was run.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Check done' })).toBeInTheDocument()
    expect(loadHealth).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
