import type { ScanStatus } from '../../shared/contracts'

type ScanProgressProps = {
  status: Extract<ScanStatus, 'queued' | 'fetching' | 'checking'>
}

const steps = [
  'Waiting to start',
  'Reading the package list',
  'Looking for known problems',
]

const currentStep = {
  queued: 0,
  fetching: 1,
  checking: 2,
} as const

const headings = {
  queued: 'Waiting to start',
  fetching: 'Reading the package list',
  checking: 'Looking for problems',
} as const

const messages = {
  queued: 'Your check is in line.',
  fetching: 'Reading the package list from GitHub.',
  checking: 'Looking for known problems in each package.',
} as const

export function ScanProgress({ status }: ScanProgressProps) {
  const active = currentStep[status]

  return (
    <section className="scan-progress" role="status" aria-live="polite">
      <div className="progress-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="eyebrow">Check running</p>
      <h1>{headings[status]}</h1>
      <p className="progress-message">{messages[status]}</p>
      <ol className="progress-steps">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index < active ? 'is-done' : index === active ? 'is-active' : ''}
            aria-current={index === active ? 'step' : undefined}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="progress-help">You can leave this page open. It will update by itself.</p>
    </section>
  )
}
