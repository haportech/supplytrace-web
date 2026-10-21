import type { PackageIdentity } from '../../shared/contracts'

const ECOSYSTEMS: Record<string, string> = {
  cargo: 'crates.io',
  composer: 'Packagist',
  gem: 'RubyGems',
  golang: 'Go',
  hex: 'Hex',
  maven: 'Maven',
  npm: 'npm',
  nuget: 'NuGet',
  pub: 'Pub',
  pypi: 'PyPI',
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

function packageName(type: string, segments: string[]): string | null {
  if (segments.length === 0) return null

  if (type === 'npm') {
    if (segments.length === 1) return segments[0]
    if (segments.length === 2 && segments[0].startsWith('@')) {
      return `${segments[0]}/${segments[1]}`
    }
    return null
  }

  if (type === 'maven') {
    if (segments.length < 2) return null
    const group = segments.slice(0, -1).join('.')
    return `${group}:${segments.at(-1)}`
  }

  if (type === 'golang' || type === 'composer') {
    return segments.join('/')
  }

  return segments.length === 1 ? segments[0] : segments.join('/')
}

export function parsePackageUrl(purl: string | undefined): PackageIdentity | null {
  if (!purl?.startsWith('pkg:')) return null

  const withoutSubpath = purl.slice(4).split('#', 1)[0]
  const core = withoutSubpath.split('?', 1)[0]
  const separator = core.indexOf('/')

  if (separator < 1) return null

  const type = core.slice(0, separator).toLowerCase()
  const ecosystem = ECOSYSTEMS[type]

  if (!ecosystem) return null

  const nameAndVersion = core.slice(separator + 1)
  const versionSeparator = nameAndVersion.lastIndexOf('@')
  const encodedName =
    versionSeparator > 0 ? nameAndVersion.slice(0, versionSeparator) : nameAndVersion
  const encodedVersion =
    versionSeparator > 0 ? nameAndVersion.slice(versionSeparator + 1) : null
  const segments = encodedName.split('/').map(decodeSegment)

  if (segments.some((segment) => segment === null)) return null

  const name = packageName(type, segments as string[])
  const version = encodedVersion === null ? null : decodeSegment(encodedVersion)

  if (!name || (encodedVersion !== null && version === null)) return null

  return {
    ecosystem,
    name,
    version,
    purl,
  }
}

