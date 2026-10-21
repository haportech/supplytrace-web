import { useRef, useState, type FormEvent } from 'react'

import type { CreateScanResponse } from '../../shared/contracts'
import { requestScan } from '../api'

export type ScanRequest = (
  repositoryUrl: string,
) => Promise<CreateScanResponse>

type RepositoryFormProps = {
  scanRequest?: ScanRequest
  onCreated: (result: CreateScanResponse) => void
}

function isPublicGitHubProjectLink(input: string): boolean {
  try {
    const url = new URL(input)
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean)
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      parts.length === 2 &&
      parts.every((part) => part.length > 0)
    )
  } catch {
    return false
  }
}

export function RepositoryForm({
  scanRequest = requestScan,
  onCreated,
}: RepositoryFormProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const value = repositoryUrl.trim()
    if (!isPublicGitHubProjectLink(value)) {
      setError('Enter a public GitHub project link.')
      inputRef.current?.focus()
      return
    }

    setError(null)
    setBusy(true)

    try {
      onCreated(await scanRequest(value))
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'We could not start the check. Try again in a few minutes.',
      )
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="scan-form"
      id="scan-form"
      onSubmit={handleSubmit}
      aria-busy={busy}
      noValidate
    >
      <div className="scan-form-heading">
        <p className="panel-kicker">Start here</p>
        <h2>Check a project</h2>
        <p>Paste one link. The check usually takes less than a minute.</p>
      </div>

      <div className="field-group">
        <label htmlFor="repository-url">GitHub project link</label>
        <div className="input-row">
          <input
            ref={inputRef}
            id="repository-url"
            name="repositoryUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck="false"
            value={repositoryUrl}
            onChange={(event) => {
              setRepositoryUrl(event.target.value)
              if (error) setError(null)
            }}
            aria-describedby={`repository-help${error ? ' repository-error' : ''}`}
            aria-invalid={error ? 'true' : 'false'}
            placeholder="https://github.com/owner/project"
            readOnly={busy}
          />
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                <span>Starting check</span>
              </>
            ) : (
              'Check project'
            )}
          </button>
        </div>
        <p className="field-help" id="repository-help">
          The project must be public. No sign-in is needed.
        </p>
        {error ? (
          <p className="field-error" id="repository-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
