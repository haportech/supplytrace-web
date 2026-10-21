import type { CreateScanResponse } from '../../shared/contracts'
import { DemoPanel } from '../components/DemoPanel'
import { ProcessSteps } from '../components/ProcessSteps'
import {
  RepositoryForm,
  type ScanRequest,
} from '../components/RepositoryForm'
import { SystemNotice } from '../components/SystemNotice'
import { SiteHeader } from '../components/SiteHeader'
import { navigateTo } from '../router'

type HomePageProps = {
  liveScansEnabled?: boolean
  scanRequest?: ScanRequest
  onNavigate?: (path: string) => void
}

const liveFacts = ['Free to use', 'No sign-in', 'Public projects only', 'Results kept 30 days']
const demoFacts = ['Example only', 'No sign-in', 'No key on the site', 'Run locally to scan']

export function HomePage({
  liveScansEnabled = false,
  scanRequest,
  onNavigate = navigateTo,
}: HomePageProps) {
  const facts = liveScansEnabled ? liveFacts : demoFacts

  function openResult(result: CreateScanResponse) {
    onNavigate(result.resultUrl)
  }

  return (
    <div
      className="app-shell"
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('a, img')) event.preventDefault()
      }}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <SiteHeader
        actionLabel={liveScansEnabled ? 'Start a check' : 'View example'}
        actionHref={liveScansEnabled ? '#scan-form' : '/example'}
      />

      <main id="main-content">
        <section className="hero-section" aria-labelledby="home-title">
          <div className="hero-copy">
            <p className="eyebrow">
              {liveScansEnabled ? 'Free safety check' : 'Public example'}
            </p>
            <h1 id="home-title">Find known problems in a GitHub project.</h1>
            <p className="hero-summary">
              {liveScansEnabled
                ? 'Paste a public GitHub link. SupplyTrace checks the small pieces of code it uses. These pieces are called packages. It shows which ones may be unsafe.'
                : 'See how SupplyTrace finds known package problems. Live checks run only on your own computer with your own GitHub key.'}
            </p>
            <ul className="result-preview" aria-label="What the result includes">
              <li>A clear danger score</li>
              <li>Problems sorted by danger</li>
              <li>Safer version numbers</li>
              <li>Links to full reports</li>
            </ul>
          </div>

          {liveScansEnabled ? (
            <RepositoryForm scanRequest={scanRequest} onCreated={openResult} />
          ) : (
            <DemoPanel />
          )}
        </section>

        <section className="fact-strip" aria-label="SupplyTrace facts">
          {facts.map((fact) => (
            <p key={fact}>
              <span aria-hidden="true" />
              {fact}
            </p>
          ))}
        </section>

        <ProcessSteps />
        {liveScansEnabled ? (
          <SystemNotice />
        ) : (
          <aside className="system-notice" aria-labelledby="demo-safety-title">
            <span className="notice-mark" aria-hidden="true">
              i
            </span>
            <div>
              <h2 id="demo-safety-title">Your key stays with you</h2>
              <p>
                This public website has no GitHub key. To run a live check,
                use your own copy of SupplyTrace on your computer.
              </p>
            </div>
          </aside>
        )}

        <section className="closing-section" aria-labelledby="closing-title">
          <div>
            <p className="eyebrow">
              {liveScansEnabled ? 'Ready when you are' : 'Safe public preview'}
            </p>
            <h2 id="closing-title">
              {liveScansEnabled ? 'Check your project now.' : 'See an example result.'}
            </h2>
          </div>
          <a
            className="primary-button link-button"
            href={liveScansEnabled ? '#scan-form' : '/example'}
          >
            {liveScansEnabled ? 'Go to the form' : 'View example result'}
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <p>Uses public data from GitHub and trusted lists of known problems.</p>
        <p>
          {liveScansEnabled
            ? 'SupplyTrace is free and does not need an account.'
            : 'The public site is an example only and has no GitHub key.'}
        </p>
      </footer>
    </div>
  )
}
