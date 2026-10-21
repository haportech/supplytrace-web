import { useState } from 'react'

import type {
  DependencyEdge,
  ScanPackage,
} from '../../shared/contracts'
import { TablePager } from './TablePager'

type DependencyTableProps = {
  packages: ScanPackage[]
  edges: DependencyEdge[]
}

const PAGE_SIZE = 100

export function DependencyTable({ packages, edges }: DependencyTableProps) {
  const [page, setPage] = useState(1)
  const names = new Map(packages.map((item) => [item.spdxId, item.name]))
  const pageCount = Math.max(1, Math.ceil(edges.length / PAGE_SIZE))
  const visibleEdges = edges.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="table-scroll">
        <table className="data-table" aria-label="Package links">
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Uses</th>
              <th scope="col">What it means</th>
            </tr>
          </thead>
          <tbody>
            {visibleEdges.map((edge, index) => (
              <tr key={`${edge.sourceSpdxId}:${edge.targetSpdxId}:${index}`}>
                <td>{names.get(edge.sourceSpdxId) ?? 'Project'}</td>
                <td>{names.get(edge.targetSpdxId) ?? edge.targetSpdxId}</td>
                <td>Uses this package</td>
              </tr>
            ))}
          </tbody>
        </table>
        {edges.length === 0 ? <p className="table-empty">No package links were listed.</p> : null}
      </div>
      <TablePager
        label="Package links"
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </>
  )
}
