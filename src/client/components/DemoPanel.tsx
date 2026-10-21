export function DemoPanel() {
  return (
    <section className="scan-form demo-panel" aria-labelledby="demo-panel-title">
      <div className="scan-form-heading">
        <p className="panel-kicker">Public demo</p>
        <h2 id="demo-panel-title">Live checks are off here.</h2>
        <p>Live checks are off on this public demo.</p>
      </div>

      <p className="demo-copy">
        Your GitHub key is never used by this website. The example uses saved
        test data and makes no outside requests.
      </p>

      <div className="demo-actions">
        <a className="primary-button link-button" href="/example">
          View example result
        </a>
        <a
          className="demo-secondary-link"
          href="https://github.com/haportech/supplytrace"
        >
          Run it on your computer
        </a>
      </div>
    </section>
  )
}
