import type { RepositoryReference } from '../../shared/contracts'

const MAX_INPUT_LENGTH = 200
const OWNER_PATTERN = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

export class RepositoryUrlError extends Error {
  readonly code = 'INVALID_REPOSITORY_URL'

  constructor(message = 'Enter a public GitHub project link.') {
    super(message)
    this.name = 'RepositoryUrlError'
  }
}

export function parseRepositoryUrl(input: string): RepositoryReference {
  const value = input.trim()

  if (value.length === 0 || value.length > MAX_INPUT_LENGTH) {
    throw new RepositoryUrlError()
  }

  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new RepositoryUrlError()
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new RepositoryUrlError()
  }

  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  const encodedSegments = path.split('/').slice(1)

  if (encodedSegments.length !== 2 || encodedSegments.some((segment) => segment === '')) {
    throw new RepositoryUrlError()
  }

  let owner: string
  let repository: string

  try {
    owner = decodeURIComponent(encodedSegments[0])
    repository = decodeURIComponent(encodedSegments[1]).replace(/\.git$/i, '')
  } catch {
    throw new RepositoryUrlError()
  }

  if (
    !OWNER_PATTERN.test(owner) ||
    !REPOSITORY_PATTERN.test(repository) ||
    repository === '.' ||
    repository === '..'
  ) {
    throw new RepositoryUrlError()
  }

  const fullName = `${owner}/${repository}`

  return {
    owner,
    repository,
    fullName,
    cacheKey: fullName.toLowerCase(),
    url: `https://github.com/${fullName}`,
  }
}
