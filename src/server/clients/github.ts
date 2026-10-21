import type { PackageIdentity, RepositoryReference } from '../../shared/contracts'
import { parsePackageUrl } from '../domain/package-url'
import { JsonHttpClient, UpstreamError } from './http'

const GITHUB_API_ROOT = 'https://api.github.com'
const GITHUB_API_VERSION = '2026-03-10'
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_FULL_SCAN_RESPONSE_BYTES = 50 * 1024 * 1024
const MAX_PACKAGES = 200
const MAX_EDGES = 400

type SpdxPackage = {
  name?: unknown
  SPDXID?: unknown
  externalRefs?: unknown
}

type SpdxRelationship = {
  spdxElementId?: unknown
  relatedSpdxElement?: unknown
  relationshipType?: unknown
}

export type NormalizedSbomPackage = PackageIdentity & {
  spdxId: string
  direct: boolean
}

export type NormalizedSbom = {
  rootSpdxId: string
  packages: NormalizedSbomPackage[]
  edges: Array<{
    sourceSpdxId: string
    targetSpdxId: string
    relationship: string
  }>
  partial: boolean
  partialReason: string | null
  skippedUnsupportedCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function packagePurl(item: SpdxPackage): string | undefined {
  if (!Array.isArray(item.externalRefs)) return undefined

  for (const reference of item.externalRefs) {
    if (!isRecord(reference)) continue
    if (
      typeof reference.referenceType === 'string' &&
      reference.referenceType.toLowerCase() === 'purl' &&
      typeof reference.referenceLocator === 'string'
    ) {
      return reference.referenceLocator
    }
  }

  return undefined
}

export class GitHubClient {
  private readonly http: JsonHttpClient
  private readonly token?: string
  private readonly fullScan: boolean

  constructor(options: {
    fetcher?: typeof fetch
    token?: string
    fullScan?: boolean
  } = {}) {
    this.http = new JsonHttpClient(options.fetcher)
    this.token = options.token?.trim() || undefined
    this.fullScan = options.fullScan ?? false
  }

  async loadSbom(repository: RepositoryReference): Promise<NormalizedSbom> {
    const headers = new Headers({
      accept: 'application/vnd.github+json',
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': 'SupplyTrace/0.1',
    })

    if (this.token) headers.set('authorization', `Bearer ${this.token}`)

    const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`

    if (this.token) {
      const details = await this.request(`${GITHUB_API_ROOT}${repositoryPath}`, headers)
      if (!isRecord(details) || typeof details.private !== 'boolean') {
        throw this.invalidResponse()
      }
      if (details.private) {
        throw new UpstreamError(
          'GITHUB_NOT_FOUND',
          'GitHub does not have a package list for this public project.',
          404,
        )
      }
    }

    const payload = await this.request(
      `${GITHUB_API_ROOT}${repositoryPath}/dependency-graph/sbom`,
      headers,
    )

    return this.normalize(payload)
  }

  private request(input: string, headers: Headers): Promise<unknown> {
    return this.http.request<unknown>(
      input,
      { method: 'GET', headers },
      {
        service: 'GITHUB',
        maxBytes: this.fullScan
          ? MAX_FULL_SCAN_RESPONSE_BYTES
          : MAX_RESPONSE_BYTES,
        timeoutMs: 15_000,
        unavailableMessage: 'GitHub is unavailable. Try again later.',
        statusCodes: {
          403: {
            code: 'GITHUB_RATE_LIMITED',
            message: 'GitHub is busy. Try again in a few minutes.',
          },
          404: {
            code: 'GITHUB_NOT_FOUND',
            message: 'GitHub does not have a package list for this public project.',
          },
          429: {
            code: 'GITHUB_RATE_LIMITED',
            message: 'GitHub is busy. Try again in a few minutes.',
          },
        },
      },
    )
  }

  private normalize(payload: unknown): NormalizedSbom {
    if (!isRecord(payload) || !isRecord(payload.sbom)) {
      throw this.invalidResponse()
    }

    const rootSpdxId = payload.sbom.SPDXID
    const rawPackages = payload.sbom.packages
    const rawRelationships = payload.sbom.relationships

    if (
      typeof rootSpdxId !== 'string' ||
      !Array.isArray(rawPackages) ||
      !Array.isArray(rawRelationships)
    ) {
      throw this.invalidResponse()
    }

    const normalized: NormalizedSbomPackage[] = []
    let skippedUnsupportedCount = 0

    for (const rawPackage of rawPackages) {
      if (!isRecord(rawPackage) || typeof rawPackage.SPDXID !== 'string') {
        skippedUnsupportedCount += 1
        continue
      }

      const identity = parsePackageUrl(packagePurl(rawPackage))
      if (!identity) {
        skippedUnsupportedCount += 1
        continue
      }

      normalized.push({
        ...identity,
        spdxId: rawPackage.SPDXID,
        direct: false,
      })
    }

    const packageLimited = !this.fullScan && normalized.length > MAX_PACKAGES
    const packages = this.fullScan
      ? normalized
      : normalized.slice(0, MAX_PACKAGES)
    const includedIds = new Set(packages.map((item) => item.spdxId))
    const candidateEdges: NormalizedSbom['edges'] = []
    const directIds = new Set<string>()

    for (const rawRelationship of rawRelationships as SpdxRelationship[]) {
      const source = rawRelationship.spdxElementId
      const target = rawRelationship.relatedSpdxElement
      const relationship = rawRelationship.relationshipType

      if (
        typeof source !== 'string' ||
        typeof target !== 'string' ||
        relationship !== 'DEPENDS_ON' ||
        !includedIds.has(target) ||
        (source !== rootSpdxId && !includedIds.has(source))
      ) {
        continue
      }

      if (source === rootSpdxId) directIds.add(target)
      candidateEdges.push({
        sourceSpdxId: source,
        targetSpdxId: target,
        relationship,
      })
    }

    for (const item of packages) item.direct = directIds.has(item.spdxId)

    const edgeLimited = !this.fullScan && candidateEdges.length > MAX_EDGES
    const edges = this.fullScan
      ? candidateEdges
      : candidateEdges.slice(0, MAX_EDGES)
    const partial =
      packageLimited || edgeLimited || skippedUnsupportedCount > 0
    const reasons: string[] = []

    if (packageLimited) reasons.push(`Only the first ${MAX_PACKAGES} supported packages were checked.`)
    if (edgeLimited) reasons.push(`Only the first ${MAX_EDGES} package links were shown.`)
    if (skippedUnsupportedCount > 0) {
      reasons.push(`${skippedUnsupportedCount} packages could not be read, so they were not checked.`)
    }

    return {
      rootSpdxId,
      packages,
      edges,
      partial,
      partialReason: reasons.length > 0 ? reasons.join(' ') : null,
      skippedUnsupportedCount,
    }
  }

  private invalidResponse(): UpstreamError {
    return new UpstreamError(
      'GITHUB_INVALID_RESPONSE',
      'GitHub sent a package list we could not read. Try again later.',
    )
  }
}
