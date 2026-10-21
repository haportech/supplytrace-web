import type { ScanResultResponse } from '../../shared/contracts'

type RiskSummaryProps = {
  result: ScanResultResponse
}

function scoreBand(score: number): string {
  if (score >= 50) return 'high'
  if (score >= 20) return 'medium'
  return 'low'
}

export function RiskSummary({ result }: RiskSummaryProps) {
  const metrics = [
    { label: 'Packages checked', value: result.packageCount },
    { label: 'Packages with problems', value: result.vulnerablePackageCount },
    { label: 'Problems found', value: result.findingCount },
    { label: 'Used in real attacks', value: result.kevCount },
  ]

  return (
    <section className="risk-section" aria-labelledby="risk-title">
      <div className={`score-card score-${scoreBand(result.riskScore)}`}>
        <p className="metric-label" id="risk-title">
          Danger score
        </p>
        <p className="score-value">
          <strong>{result.riskScore}</strong>
          <span>/100</span>
        </p>
        <p>A higher number means more or worse known problems.</p>
      </div>

      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{metric.value.toLocaleString()}</p>
          </article>
        ))}
      </div>

      <details className="score-rules">
        <summary>How points are added</summary>
        <p>
          Very high problems add 10 points. High add 6. Medium add 3. Low or
          not rated add 1. A problem used in a real attack adds 15 more
          points. The highest score is 100.
        </p>
      </details>
    </section>
  )
}
