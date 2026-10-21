import { useEffect, useMemo, useState } from 'react'

import type {
  ScanFinding,
  ScanResultResponse,
  ScanStatus,
} from '../../shared/contracts'
import { requestScanResult } from '../api'
import { DependencyGraph } from '../components/DependencyGraph'
import { DependencyTable } from '../components/DependencyTable'
import { EmptyState } from '../components/EmptyState'
import { FindingDetail } from '../components/FindingDetail'
import { FindingsTable } from '../components/FindingsTable'
import { RiskSummary } from '../components/RiskSummary'
import { ScanProgress } from '../components/ScanProgress'
import { SiteHeader } from '../components/SiteHeader'

export type ScanLoader = (
  scanId: string,
  signal?: AbortSignal,
) => Promise<ScanResultResponse>

type ScanPageProps = {
  scanId: string
  loadScan?: ScanLoader
  pollDelayMs?: number
  example?: boolean
}

type WorkingStatus = Extract<ScanStatus, 'queued' | 'fetching' | 'checking'>

function isWorking(status: ScanStatus): status is WorkingStatus {
  return status === 'queued' || status === 'fetching' || status === 'checking'
}

function publicError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'We could not load this check. Try again in a few minutes.'
}

export function ScanPage({
  scanId,
  loadScan = requestScanResult,
  pollDelayMs = 1500,
  example = false,
}: ScanPageProps) {
  const [result, setResult] = useState<ScanResultResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [view, setView] = useState<'map' | 'table'>('map')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    async function load(): Promise<void> {
      controller = new AbortController()

      try {
        const next = await loadScan(scanId, controller.signal)
        if (stopped) return
        setResult(next)
        setError(null)

        if (isWorking(next.status)) {
          timer = setTimeout(load, pollDelayMs)
        }
      } catch (loadError) {
        if (stopped || (loadError instanceof DOMException && loadError.name === 'AbortError')) {
          return
        }
        setError(publicError(loadError))
      }
    }

    void load()

    return () => {
      stopped = true
      controller?.abort()
      if (timer) clearTimeout(timer)
    }
  }, [loadScan, pollDelayMs, retryKey, scanId])

  const selected = useMemo<ScanFinding | null>(
    () =>
      result?.findings.find((finding) => finding.id === selectedId) ??
      result?.findings[0] ??
      null,
    [result, selectedId],
  )

  function retry() {
    setError(null)
    setResult(null)
    setRetryKey((value) => value + 1)
  }

  let content

  if (error) {
    content = (
      <EmptyState
        title="We could not load this check"
        text={error}
        actionLabel="Try again"
        onAction={retry}
        tone="danger"
      />
    )
  } else if (!result) {
    content = (
      <section className="scan-loading" role="status" aria-live="polite">
        <span className="loading-ring" aria-hidden="true" />
        <p>Loading the check…</p>
      </section>
    )
  } else if (isWorking(result.status)) {
    content = (
      <ScanProgress status={result.status} />
    )
  } else if (result.status === 'failed') {
    content = (
      <EmptyState
        title="The check stopped"
        text={result.statusMessage}
        actionLabel="Check another project"
        actionHref="/"
        tone="danger"
      />
    )
  } else {
    content = (
      <>
        {example ? (
          <aside className="partial-notice example-notice" aria-labelledby="example-title">
            <h2 id="example-title">Example result</h2>
            <p>Example result — no live check was run.</p>
          </aside>
        ) : null}
        <section className="result-heading" aria-labelledby="result-title">
          <div>
            <p className="eyebrow">
              {result.status === 'partial' ? 'Done, but some parts were skipped' : 'Done'}
            </p>
            <h1 id="result-title">Check done</h1>
            <p className="result-repository">
              {example ? (
                <span>{result.repository.fullName}</span>
              ) : (
                <a href={result.repository.url} target="_blank" rel="noreferrer">
                  {result.repository.fullName}
                </a>
              )}
            </p>
          </div>
          <span className={`result-status status-${result.status}`}>
            {result.status === 'partial' ? 'Some parts skipped' : 'Done'}
          </span>
        </section>

        {result.partial && result.partialReason ? (
          <aside className="partial-notice" aria-labelledby="partial-title">
            <h2 id="partial-title">Some parts were skipped</h2>
            <p>{result.partialReason}</p>
          </aside>
        ) : null}

        <RiskSummary result={result} />

        <section className="dashboard-section" aria-labelledby="packages-title">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">Package links</p>
              <h2 id="packages-title">How the packages connect</h2>
              <p>Use the map for a quick look or the table for every saved link.</p>
            </div>
            <div className="view-switch" aria-label="Package link view">
              <button
                type="button"
                className={view === 'map' ? 'is-active' : ''}
                aria-pressed={view === 'map'}
                onClick={() => setView('map')}
              >
                Package map
              </button>
              <button
                type="button"
                className={view === 'table' ? 'is-active' : ''}
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
              >
                Link table
              </button>
            </div>
          </div>
          {view === 'map' ? (
            <DependencyGraph packages={result.packages} edges={result.edges} />
          ) : (
            <DependencyTable packages={result.packages} edges={result.edges} />
          )}
        </section>

        <section className="dashboard-section findings-section" aria-labelledby="problems-title">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">Safety check</p>
              <h2 id="problems-title">Known package problems</h2>
              <p>Very high means the most danger. Pick a problem to see more.</p>
            </div>
          </div>

          {result.findings.length === 0 ? (
            <EmptyState
              title="No known problems found"
              text="This check found no known problems in the package versions it could read. The project may still have other problems."
              headingLevel={2}
              tone="safe"
            />
          ) : (
            <div className="findings-layout">
              <FindingsTable
                findings={result.findings}
                packages={result.packages}
                selectedId={selected?.id ?? null}
                onSelect={(finding) => setSelectedId(finding.id)}
              />
              <FindingDetail finding={selected} packages={result.packages} />
            </div>
          )}
        </section>
      </>
    )
  }

  return (
    <div
      className="app-shell result-shell"
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('a, img')) event.preventDefault()
      }}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader actionLabel={example ? 'Go home' : 'New check'} actionHref="/" />
      <main id="main-content" className="result-main" tabIndex={-1}>
        {content}
      </main>
      <footer className="site-footer result-footer">
        <p>Results use public lists of known package problems.</p>
        <p>
          {example
            ? 'This example stays available and makes no outside requests.'
            : 'Saved results are removed after 30 days.'}
        </p>
      </footer>
    </div>
  )
}
