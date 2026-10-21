import type {
  DependencyEdge,
  ScanPackage,
} from '../../shared/contracts'

type DependencyGraphProps = {
  packages: ScanPackage[]
  edges: DependencyEdge[]
}

type Point = { x: number; y: number }

function shortName(value: string): string {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value
}

export function DependencyGraph({ packages, edges }: DependencyGraphProps) {
  const visible = [...packages]
    .sort(
      (left, right) =>
        right.vulnerabilityCount - left.vulnerabilityCount ||
        Number(right.direct) - Number(left.direct) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 24)
  const positions = new Map<string, Point>()
  const columnCount = 4
  const nodeWidth = 170
  const nodeHeight = 58

  visible.forEach((item, index) => {
    positions.set(item.spdxId, {
      x: 130 + (index % columnCount) * 190,
      y: 120 + Math.floor(index / columnCount) * 90,
    })
  })

  const height = Math.max(290, 180 + Math.ceil(visible.length / columnCount) * 90)
  const root = { x: 35, y: 28 }
  const visibleEdges = edges.filter((edge) => positions.has(edge.targetSpdxId))

  return (
    <div className="graph-wrap">
      <svg
        className="dependency-graph"
        viewBox={`0 0 900 ${height}`}
        role="img"
        aria-label={`Package map with ${visible.length} packages and ${visibleEdges.length} links`}
      >
        <g className="graph-root">
          <rect x={root.x} y={root.y} width={nodeWidth} height={nodeHeight} rx="8" />
          <text x={root.x + 14} y={root.y + 25}>Project</text>
          <text className="node-note" x={root.x + 14} y={root.y + 44}>
            starting point
          </text>
        </g>

        <g className="graph-lines" aria-hidden="true">
          {visibleEdges.map((edge, index) => {
            const source = positions.get(edge.sourceSpdxId) ?? root
            const target = positions.get(edge.targetSpdxId)
            if (!target) return null
            return (
              <line
                key={`${edge.sourceSpdxId}:${edge.targetSpdxId}:${index}`}
                x1={source.x + nodeWidth / 2}
                y1={source.y + nodeHeight}
                x2={target.x + nodeWidth / 2}
                y2={target.y}
              />
            )
          })}
        </g>

        {visible.map((item) => {
          const point = positions.get(item.spdxId)
          if (!point) return null
          const problemText =
            item.vulnerabilityCount === 0
              ? 'No known problems'
              : `${item.vulnerabilityCount} known ${item.vulnerabilityCount === 1 ? 'problem' : 'problems'}`
          return (
            <g
              key={item.id}
              className={item.vulnerabilityCount > 0 ? 'graph-node has-problems' : 'graph-node'}
            >
              <title>{`${item.name} ${item.version ?? ''}: ${problemText}`}</title>
              <rect x={point.x} y={point.y} width={nodeWidth} height={nodeHeight} rx="8" />
              <text x={point.x + 14} y={point.y + 24}>{shortName(item.name)}</text>
              <text className="node-note" x={point.x + 14} y={point.y + 44}>
                {problemText}
              </text>
            </g>
          )
        })}
      </svg>
      {packages.length > visible.length ? (
        <p className="graph-note">
          The map shows the first {visible.length} important packages. Use the
          table to see every link.
        </p>
      ) : null}
    </div>
  )
}
