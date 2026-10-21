import type {
  ScanFinding,
  ScanPackage,
} from '../../shared/contracts'
import { dangerLabel } from '../plain-language'

type FindingDetailProps = {
  finding: ScanFinding | null
  packages: ScanPackage[]
}

function safeReports(values: string[]): string[] {
  return values.flatMap((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' ? [url.toString()] : []
    } catch {
      return []
    }
  })
}

export function FindingDetail({ finding, packages }: FindingDetailProps) {
  if (!finding) {
    return (
      <aside className="finding-detail empty-detail">
        <h3>Problem details</h3>
        <p>Choose a problem to see more.</p>
      </aside>
    )
  }

  const packageItem = packages.find((item) => item.id === finding.packageId)
  const reports = safeReports(finding.evidenceUrls)

  return (
    <aside className="finding-detail" aria-labelledby="finding-detail-title">
      <div className="detail-heading">
        <span className={`severity-badge severity-${finding.severity}`}>
          {dangerLabel(finding.severity)}
        </span>
        <h3 id="finding-detail-title">{finding.osvId}</h3>
      </div>
      <p className="detail-summary">
        This package version has a known safety problem.
      </p>

      <details className="report-words">
        <summary>Show the report's words</summary>
        <p>{finding.summary}</p>
      </details>

      <dl className="detail-list">
        <div>
          <dt>Package</dt>
          <dd>{packageItem?.name ?? 'Unknown package'}</dd>
        </div>
        <div>
          <dt>Version checked</dt>
          <dd>{packageItem?.version ?? 'Not listed'}</dd>
        </div>
        <div>
          <dt>Safer version</dt>
          <dd>
            {finding.fixedVersions.length > 0
              ? finding.fixedVersions.join(', ')
              : 'No safer version was listed.'}
          </dd>
        </div>
      </dl>

      {finding.isKev ? (
        <div className="attack-note">
          <strong>Used in real attacks</strong>
          <p>A trusted list says attackers have used this problem.</p>
          {finding.knownRansomwareUse ? (
            <p>
              It was also linked to ransomware. This kind of attack locks
              files and asks for money.
            </p>
          ) : null}
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className="report-links">
          <h4>Full reports</h4>
          {reports.map((url, index) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              Open report {index + 1}
            </a>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
