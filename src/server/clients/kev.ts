import { JsonHttpClient, safeHttpsUrls, UpstreamError } from './http'

const CISA_KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export type KevEntry = {
  cveId: string
  dueDate: string | null
  knownRansomwareUse: boolean | null
  evidenceUrls: string[]
}

export type KevCatalog = Map<string, KevEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ransomwareUse(value: unknown): boolean | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'known' || normalized === 'yes') return true
  if (normalized === 'no') return false
  return null
}

function notesUrls(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return safeHttpsUrls(value.split(/[;\s]+/), 6)
}

export class KevClient {
  private readonly http: JsonHttpClient

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.http = new JsonHttpClient(options.fetcher)
  }

  async load(cache?: Cache): Promise<KevCatalog> {
    const cacheKey = new Request(CISA_KEV_URL)

    if (cache) {
      try {
        const cached = await cache.match(cacheKey)
        if (cached) return this.normalize(await cached.json())
      } catch {
        // Cache failure must not block a fresh catalog request.
      }
    }

    const payload = await this.http.request<unknown>(
      CISA_KEV_URL,
      { method: 'GET', headers: { accept: 'application/json' } },
      {
        service: 'CISA',
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: 15_000,
        unavailableMessage: 'One safety list is not available, so some details may be missing.',
      },
    )

    if (cache) {
      try {
        await cache.put(
          cacheKey,
          new Response(JSON.stringify(payload), {
            headers: {
              'content-type': 'application/json',
              'cache-control': 'public, max-age=86400',
            },
          }),
        )
      } catch {
        // The fresh result remains usable when Cache API storage fails.
      }
    }

    return this.normalize(payload)
  }

  private normalize(payload: unknown): KevCatalog {
    if (!isRecord(payload) || !Array.isArray(payload.vulnerabilities)) {
      throw new UpstreamError(
        'CISA_INVALID_RESPONSE',
        'One safety list could not be read, so some details may be missing.',
      )
    }

    const catalog: KevCatalog = new Map()

    for (const value of payload.vulnerabilities) {
      if (!isRecord(value) || typeof value.cveID !== 'string') continue
      const cveId = value.cveID.trim().toUpperCase()
      if (!/^CVE-\d{4}-\d{4,}$/.test(cveId)) continue
      const dueDate =
        typeof value.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)
          ? value.dueDate
          : null

      catalog.set(cveId, {
        cveId,
        dueDate,
        knownRansomwareUse: ransomwareUse(value.knownRansomwareCampaignUse),
        evidenceUrls: notesUrls(value.notes),
      })
    }

    return catalog
  }
}

export function matchKev(catalog: KevCatalog, aliases: string[]): KevEntry | null {
  for (const alias of aliases) {
    const entry = catalog.get(alias.trim().toUpperCase())
    if (entry) return entry
  }
  return null
}
