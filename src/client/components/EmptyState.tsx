type EmptyStateProps = {
  title: string
  text: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  headingLevel?: 1 | 2
  tone?: 'safe' | 'danger' | 'neutral'
}

export function EmptyState({
  title,
  text,
  actionLabel,
  actionHref,
  onAction,
  headingLevel = 1,
  tone = 'neutral',
}: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <section className={`empty-state empty-state-${tone}`}>
      <span className="empty-state-mark" aria-hidden="true" />
      <Heading>{title}</Heading>
      <p>{text}</p>
      {actionLabel && actionHref ? (
        <a className="primary-button link-button" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
      {actionLabel && onAction ? (
        <button className="primary-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  )
}
