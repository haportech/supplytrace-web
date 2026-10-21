import { useMemo, useState } from 'react'

import type {
  ScanFinding,
  ScanPackage,
  Severity,
} from '../../shared/contracts'
import { dangerLabel } from '../plain-language'
import { TablePager } from './TablePager'

type FindingsTableProps = {
  findings: ScanFinding[]
  packages: ScanPackage[]
  selectedId: string | null
  onSelect: (finding: ScanFinding) => void
}

type FindingFilter = 'all' | Severity

const PAGE_SIZE = 100

const filters: Array<{ value: FindingFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Very high' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'unknown', label: 'Not rated' },
]

function saferVersion(finding: ScanFinding): string {
  return finding.fixedVersions.length > 0
    ? finding.fixedVersions.join(', ')
    : 'No safer version listed'
}

export function FindingsTable({
  findings,
  packages,
  selectedId,
  onSelect,
}: FindingsTableProps) {
  const [filter, setFilter] = useState<FindingFilter>('all')
  const [page, setPage] = useState(1)
  const packageNames = useMemo(
    () => new Map(packages.map((item) => [item.id, item.name])),
    [packages],
  )
  const shown =
    filter === 'all'
      ? findings
      : findings.filter((finding) => finding.severity === filter)
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const visible = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function chooseFilter(next: FindingFilter): void {
    const nextShown =
      next === 'all'
        ? findings
        : findings.filter((finding) => finding.severity === next)
    setFilter(next)
    setPage(1)
    if (nextShown[0]) onSelect(nextShown[0])
  }

  return (
    <div className="findings-table-wrap">
      <div className="filter-bar" aria-label="Filter problems by danger">
        {filters.map((item) => {
          const count =
            item.value === 'all'
              ? findings.length
              : findings.filter((finding) => finding.severity === item.value).length
          return (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? 'is-active' : ''}
              disabled={count === 0}
              aria-pressed={filter === item.value}
              aria-label={
                item.value === 'all'
                  ? 'Show all problems'
                  : `Show ${item.label.toLowerCase()} only`
              }
              onClick={() => chooseFilter(item.value)}
            >
              {item.label} <span>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="table-scroll">
        <table className="data-table findings-table" aria-label="Known package problems">
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Danger</th>
              <th scope="col">Problem</th>
              <th scope="col">Safer version</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((finding) => (
              <tr
                key={finding.id}
                className={selectedId === finding.id ? 'is-selected' : ''}
              >
                <td>{packageNames.get(finding.packageId) ?? 'Unknown package'}</td>
                <td>
                  <span className={`severity-badge severity-${finding.severity}`}>
                    {dangerLabel(finding.severity)}
                  </span>
                </td>
                <td>
                  <button
                    className="finding-link"
                    type="button"
                    aria-label={`Open ${finding.osvId} details`}
                    onClick={() => onSelect(finding)}
                  >
                    <span>{finding.osvId}</span>
                    <small>This package has a known problem.</small>
                  </button>
                </td>
                <td>{saferVersion(finding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager
        label="Problems"
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
      {shown.length === 0 ? (
        <p className="table-empty">No problems match this filter.</p>
      ) : null}
    </div>
  )
}
