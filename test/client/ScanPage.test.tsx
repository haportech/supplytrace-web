import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '../../src/client/api'
import {
  ScanPage,
  type ScanLoader,
} from '../../src/client/pages/ScanPage'
import { scanResult } from '../helpers/scan-result'

const scanId = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ScanPage', () => {
  it('shows each work step while a scan is running', async () => {
    const loader = vi.fn<ScanLoader>().mockResolvedValue(
      scanResult({
        status: 'fetching',
        statusMessage: 'Reading the package list from GitHub.',
        completedAt: null,
        packages: [],
        edges: [],
        findings: [],
        packageCount: 0,
        findingCount: 0,
      }),
    )

    render(<ScanPage scanId={scanId} loadScan={loader} pollDelayMs={60_000} />)

    expect(screen.getByText('Loading the check…')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Reading the package list' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Looking for known problems')).toBeInTheDocument()
  })

  it('polls until the scan is complete and then stops', async () => {
    vi.useFakeTimers()
    const loader = vi
      .fn<ScanLoader>()
      .mockResolvedValueOnce(
        scanResult({
          status: 'checking',
          statusMessage: 'Checking the packages for known problems.',
          completedAt: null,
        }),
      )
      .mockResolvedValue(scanResult())

    render(<ScanPage scanId={scanId} loadScan={loader} pollDelayMs={1000} />)
    await act(async () => Promise.resolve())
    expect(screen.getByText('Looking for problems')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByRole('heading', { name: 'Check done' })).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('shows an honest note when some checks were skipped', async () => {
    const loader = vi.fn<ScanLoader>().mockResolvedValue(
      scanResult({
        status: 'partial',
        statusMessage: 'Scan complete with some checks skipped.',
        partial: true,
        partialReason: 'Two package versions were unclear, so they were not checked.',
      }),
    )

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    expect(await screen.findByText('Some parts were skipped')).toBeInTheDocument()
    expect(
      screen.getByText('Two package versions were unclear, so they were not checked.'),
    ).toBeInTheDocument()
  })

  it('shows a clear empty result', async () => {
    const loader = vi.fn<ScanLoader>().mockResolvedValue(
      scanResult({
        riskScore: 0,
        kevCount: 0,
        findingCount: 0,
        vulnerablePackageCount: 0,
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        findings: [],
      }),
    )

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    expect(
      await screen.findByRole('heading', { name: 'No known problems found' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/may still have other problems/i)).toBeInTheDocument()
  })

  it('shows a stopped scan and links back to the form', async () => {
    const loader = vi.fn<ScanLoader>().mockResolvedValue(
      scanResult({
        status: 'failed',
        statusMessage: 'GitHub is busy. Try again in a few minutes.',
        completedAt: null,
      }),
    )

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    expect(await screen.findByRole('heading', { name: 'The check stopped' })).toBeInTheDocument()
    expect(screen.getByText('GitHub is busy. Try again in a few minutes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Check another project' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('can retry after a result request fails', async () => {
    const user = userEvent.setup()
    const loader = vi
      .fn<ScanLoader>()
      .mockRejectedValueOnce(
        new ApiRequestError('SCAN_NOT_FOUND', 'We could not find that check.', 404),
      )
      .mockResolvedValue(scanResult())

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    expect(await screen.findByRole('heading', { name: 'We could not load this check' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Check done' })).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('switches between the map and the plain relationship table', async () => {
    const user = userEvent.setup()
    const loader = vi.fn<ScanLoader>().mockResolvedValue(scanResult())

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    expect(await screen.findByRole('img', { name: /package map/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Link table' }))
    const relationshipTable = screen.getByRole('table', {
      name: 'Package links',
    })
    expect(relationshipTable).toBeInTheDocument()
    expect(within(relationshipTable).getAllByText('lodash')).not.toHaveLength(0)
  })

  it('shows details for a problem that matches the chosen danger level', async () => {
    const user = userEvent.setup()
    const loader = vi.fn<ScanLoader>().mockResolvedValue(scanResult())

    render(<ScanPage scanId={scanId} loadScan={loader} />)

    await screen.findByRole('heading', { name: 'Check done' })
    await user.click(screen.getByRole('button', { name: 'Show medium only' }))

    expect(
      screen.getByRole('complementary', { name: 'GHSA-test-two' }),
    ).toBeInTheDocument()
  })

  it('clearly marks built-in data as an example', async () => {
    const loader = vi.fn<ScanLoader>().mockResolvedValue(scanResult())

    render(<ScanPage scanId={scanId} loadScan={loader} example />)

    expect(
      await screen.findByText('Example result — no live check was run.'),
    ).toBeInTheDocument()
    expect(screen.getByText('example/project')).not.toHaveAttribute('href')
    expect(
      screen.getByText('This example stays available and makes no outside requests.'),
    ).toBeInTheDocument()
  })
})
