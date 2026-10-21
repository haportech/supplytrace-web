export function SystemNotice() {
  return (
    <aside className="system-notice" aria-labelledby="limits-title">
      <span className="notice-mark" aria-hidden="true">
        i
      </span>
      <div>
        <h2 id="limits-title">Why there are limits</h2>
        <p>
          SupplyTrace is free. Each person can start 3 new checks an hour, and
          the site starts up to 20 each day. A recent result may be reused.
        </p>
      </div>
    </aside>
  )
}
