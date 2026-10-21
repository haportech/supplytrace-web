import batchFixture from '../fixtures/osv-batch.json'
import vulnerabilityFixture from '../fixtures/osv-vulnerability.json'
import { describe, expect, it } from 'vitest'

import { UpstreamError } from '../../src/server/clients/http'
import { OsvClient } from '../../src/server/clients/osv'
import { createFetchQueue, jsonResponse } from '../helpers/fetch'

const input = {
  packageId: 'package-lodash',
  identity: {
    ecosystem: 'npm',
    name: 'lodash',
    version: '4.17.20',
    purl: 'pkg:npm/lodash@4.17.20',
  },
}

describe('OsvClient', () => {
  it('batches package queries and loads evidence for returned IDs', async () => {
    const { fetcher, calls } = createFetchQueue([
      jsonResponse(batchFixture),
      jsonResponse(vulnerabilityFixture),
    ])
    const result = await new OsvClient({ fetcher }).checkPackages([input])

    expect(String(calls[0].input)).toBe('https://api.osv.dev/v1/querybatch')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      queries: [
        {
          version: '4.17.20',
          package: { ecosystem: 'npm', name: 'lodash' },
        },
      ],
    })
    expect(String(calls[1].input)).toBe(
      'https://api.osv.dev/v1/vulns/GHSA-29mw-wpgm-hmr9',
    )
    expect(result).toMatchObject({ partial: false, skippedPackageCount: 0 })
    expect(result.findings[0]).toMatchObject({
      packageId: 'package-lodash',
      osvId: 'GHSA-29mw-wpgm-hmr9',
      severity: 'medium',
      aliases: ['CVE-2020-28500'],
      fixedVersions: ['4.17.21'],
    })
    expect(result.findings[0].evidenceUrls).toEqual([
      'https://osv.dev/vulnerability/GHSA-29mw-wpgm-hmr9',
      'https://nvd.nist.gov/vuln/detail/CVE-2020-28500',
    ])
  })

  it('skips package ranges because OSV needs an exact version', async () => {
    const { fetcher, calls } = createFetchQueue([jsonResponse({ results: [] })])
    const result = await new OsvClient({ fetcher }).checkPackages([
      {
        ...input,
        identity: { ...input.identity, version: '^4.17.20' },
      },
    ])

    expect(calls).toHaveLength(0)
    expect(result).toMatchObject({
      findings: [],
      partial: true,
      skippedPackageCount: 1,
    })
  })

  it('rejects a batch whose result count does not match the query count', async () => {
    const { fetcher } = createFetchQueue([jsonResponse({ results: [] })])

    await expect(new OsvClient({ fetcher }).checkPackages([input])).rejects.toMatchObject<
      Partial<UpstreamError>
    >({ code: 'OSV_INVALID_RESPONSE' })
  })

  it('rejects a malformed result entry instead of treating it as safe', async () => {
    const { fetcher } = createFetchQueue([jsonResponse({ results: ['broken'] })])

    await expect(new OsvClient({ fetcher }).checkPackages([input])).rejects.toMatchObject<
      Partial<UpstreamError>
    >({ code: 'OSV_INVALID_RESPONSE' })
  })

  it('loads every known problem in local full mode', async () => {
    const ids = Array.from({ length: 41 }, (_, index) => `OSV-${index}`)
    const fetcher = (async (request: RequestInfo | URL) => {
      const url = String(request)

      if (url.endsWith('/querybatch')) {
        return jsonResponse({
          results: [{ vulns: ids.map((id) => ({ id })) }],
        })
      }

      const id = decodeURIComponent(url.split('/').at(-1) ?? '')
      return jsonResponse({ id, summary: `Problem ${id}` })
    }) as typeof fetch

    const result = await new OsvClient({
      fetcher,
      fullScan: true,
    }).checkPackages([input])

    expect(result.findings).toHaveLength(41)
    expect(result.partial).toBe(false)
    expect(result.partialReason).toBeNull()
  })

  it('keeps the public known-problem limit', async () => {
    const ids = Array.from({ length: 41 }, (_, index) => `OSV-${index}`)
    const fetcher = (async (request: RequestInfo | URL) => {
      const url = String(request)

      if (url.endsWith('/querybatch')) {
        return jsonResponse({
          results: [{ vulns: ids.map((id) => ({ id })) }],
        })
      }

      const id = decodeURIComponent(url.split('/').at(-1) ?? '')
      return jsonResponse({ id, summary: `Problem ${id}` })
    }) as typeof fetch

    const result = await new OsvClient({ fetcher }).checkPackages([input])

    expect(result.findings).toHaveLength(40)
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe(
      'Only the first 40 known problems were loaded.',
    )
  })
})
