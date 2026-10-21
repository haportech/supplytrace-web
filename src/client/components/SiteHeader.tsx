type SiteHeaderProps = {
  actionLabel: string
  actionHref: string
}

export function SiteHeader({ actionLabel, actionHref }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="SupplyTrace home">
        <span className="wordmark-mark" aria-hidden="true">
          ST
        </span>
        <span>SupplyTrace</span>
      </a>
      <a className="header-action" href={actionHref}>
        {actionLabel}
      </a>
    </header>
  )
}
