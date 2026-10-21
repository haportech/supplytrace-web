const steps = [
  {
    title: 'Paste a link',
    text: 'Use the link to any public GitHub project.',
  },
  {
    title: 'Wait for the check',
    text: 'We read its package list and look for known problems.',
  },
  {
    title: 'Read the result',
    text: 'See the problems and a safer version when one is listed.',
  },
]

export function ProcessSteps() {
  return (
    <section className="process-section" aria-labelledby="process-title">
      <div className="section-heading">
        <p className="eyebrow">Three simple steps</p>
        <h2 id="process-title">How it works</h2>
      </div>
      <ol className="process-list">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="step-number" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
