type TablePagerProps = {
  label: string
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

export function TablePager({
  label,
  page,
  pageCount,
  onPageChange,
}: TablePagerProps) {
  if (pageCount <= 1) return null

  return (
    <nav className="table-pager" aria-label={`${label} pages`}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  )
}
