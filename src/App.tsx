import { useEffect, useState } from 'react'

import { requestHealth } from './client/api'
import { EmptyState } from './client/components/EmptyState'
import { SiteHeader } from './client/components/SiteHeader'
import { HomePage } from './client/pages/HomePage'
import { ScanPage, type ScanLoader } from './client/pages/ScanPage'
import {
  onRouteChange,
  readRoute,
  type AppRoute,
} from './client/router'
import type { HealthResponse } from './shared/contracts'
import { exampleResult } from './shared/example-result'

type AppProps = {
  loadHealth?: () => Promise<HealthResponse>
}

const loadExampleScan: ScanLoader = async () => exampleResult

function NotFoundPage() {
  return (
    <div className="app-shell result-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader actionLabel="Go home" actionHref="/" />
      <main id="main-content" className="result-main">
        <EmptyState
          title="Page not found"
          text="That page does not exist. Go home to start a new check."
          actionLabel="Go home"
          actionHref="/"
        />
      </main>
    </div>
  )
}

function App({ loadHealth = requestHealth }: AppProps) {
  const [route, setRoute] = useState<AppRoute>(() => readRoute())
  const [liveScansEnabled, setLiveScansEnabled] = useState(false)

  useEffect(
    () => onRouteChange(() => setRoute(readRoute())),
    [],
  )

  useEffect(() => {
    if (route.name !== 'home') {
      return
    }

    let stopped = false

    void loadHealth()
      .then((health) => {
        if (!stopped) setLiveScansEnabled(health.liveScansEnabled)
      })
      .catch(() => {
        if (!stopped) setLiveScansEnabled(false)
      })

    return () => {
      stopped = true
    }
  }, [loadHealth, route.name])

  if (route.name === 'scan') return <ScanPage scanId={route.scanId} />
  if (route.name === 'example') {
    return (
      <ScanPage
        scanId={exampleResult.scanId}
        loadScan={loadExampleScan}
        example
      />
    )
  }
  if (route.name === 'not-found') return <NotFoundPage />
  return <HomePage liveScansEnabled={liveScansEnabled} />
}

export default App
