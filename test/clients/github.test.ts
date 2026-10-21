import githubFixture from '../fixtures/github-sbom.json'
import { describe, expect, it } from 'vitest'

import { GitHubClient } from '../../src/server/clients/github'
import { UpstreamError } from '../../src/server/clients/http'
import { createFetchQueue, jsonResponse } from '../helpers/fetch'

const repository = {
  owner: 'expressjs',
  repository: 'express',
  fullName: 'expressjs/express',
  cacheKey: 'expressjs/express',
  url: 'https://github.com/expressjs/express',
}

describe('GitHubClient', () => {
  it('loads and normalizes a GitHub SPDX SBOM', async () => {
    const { fetcher, calls } = createFetchQueue([
      jsonResponse({ private: false }),
      jsonResponse(githubFixture),
    ])
    const client = new GitHubClient({ fetcher, token: 'server-secret' })

    const result = await client.loadSbom(repository)

    expect(String(calls[0].input)).toBe(
      'https://api.github.com/repos/expressjs/express',
    )
    expect(String(calls[1].input)).toBe(
      'https://api.github.com/repos/expressjs/express/dependency-graph/sbom',
    )
    expect(new Headers(calls[1].init?.headers).get('authorization')).toBe(
      'Bearer server-secret',
    )
    expect(result).toMatchObject({
      rootSpdxId: 'SPDXRef-DOCUMENT',
      partial: true,
      skippedUnsupportedCount: 1,
    })
    expect(result.packages).toHaveLength(2)
    expect(result.packages[0]).toMatchObject({
      spdxId: 'SPDXRef-Package-lodash',
      name: 'lodash',
      version: '4.17.20',
      direct: true,
    })
    expect(result.edges).toHaveLength(2)
  })

  it('does not send an authorization header without a token', async () => {
    const { fetcher, calls } = createFetchQueue([jsonResponse(githubFixture)])
    await new GitHubClient({ fetcher }).loadSbom(repository)

    expect(new Headers(calls[0].init?.headers).has('authorization')).toBe(false)
  })

  it('does not read a private project when a server token is present', async () => {
    const { fetcher, calls } = createFetchQueue([
      jsonResponse({ private: true }),
    ])

    await expect(
      new GitHubClient({ fetcher, token: 'server-secret' }).loadSbom(repository),
    ).rejects.toMatchObject<Partial<UpstreamError>>({
      code: 'GITHUB_NOT_FOUND',
    })
    expect(calls).toHaveLength(1)
  })

  it.each([
    [404, 'GITHUB_NOT_FOUND'],
    [403, 'GITHUB_RATE_LIMITED'],
    [429, 'GITHUB_RATE_LIMITED'],
    [500, 'GITHUB_UNAVAILABLE'],
  ])('maps GitHub status %s to %s', async (status, code) => {
    const { fetcher } = createFetchQueue([new Response('hidden', { status })])

    await expect(new GitHubClient({ fetcher }).loadSbom(repository)).rejects.toMatchObject<
      Partial<UpstreamError>
    >({ code })
  })

  it('rejects a malformed SBOM', async () => {
    const { fetcher } = createFetchQueue([jsonResponse({ sbom: { packages: [] } })])

    await expect(new GitHubClient({ fetcher }).loadSbom(repository)).rejects.toMatchObject<
      Partial<UpstreamError>
    >({ code: 'GITHUB_INVALID_RESPONSE' })
  })

  it('caps a large project at the free package and link limits', async () => {
    const packages = Array.from({ length: 205 }, (_, index) => ({
      name: `package-${index}`,
      SPDXID: `SPDXRef-Package-${index}`,
      externalRefs: [
        {
          referenceType: 'purl',
          referenceLocator: `pkg:npm/package-${index}@1.0.0`,
        },
      ],
    }))
    const relationships = Array.from({ length: 405 }, (_, index) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relatedSpdxElement: `SPDXRef-Package-${index % 200}`,
      relationshipType: 'DEPENDS_ON',
    }))
    const { fetcher } = createFetchQueue([
      jsonResponse({
        sbom: {
          SPDXID: 'SPDXRef-DOCUMENT',
          packages,
          relationships,
        },
      }),
    ])

    const result = await new GitHubClient({ fetcher }).loadSbom(repository)

    expect(result.packages).toHaveLength(200)
    expect(result.edges).toHaveLength(400)
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe(
      'Only the first 200 supported packages were checked. Only the first 400 package links were shown.',
    )
  })

  it('keeps the full package and link inventory in local full mode', async () => {
    const packages = Array.from({ length: 205 }, (_, index) => ({
      name: `package-${index}`,
      SPDXID: `SPDXRef-Package-${index}`,
      externalRefs: [
        {
          referenceType: 'purl',
          referenceLocator: `pkg:npm/package-${index}@1.0.0`,
        },
      ],
    }))
    const relationships = Array.from({ length: 405 }, (_, index) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relatedSpdxElement: `SPDXRef-Package-${index % 205}`,
      relationshipType: 'DEPENDS_ON',
    }))
    const { fetcher } = createFetchQueue([
      jsonResponse({
        sbom: {
          SPDXID: 'SPDXRef-DOCUMENT',
          packages,
          relationships,
        },
      }),
    ])

    const result = await new GitHubClient({
      fetcher,
      fullScan: true,
    }).loadSbom(repository)

    expect(result.packages).toHaveLength(205)
    expect(result.edges).toHaveLength(405)
    expect(result.partial).toBe(false)
    expect(result.partialReason).toBeNull()
  })
})
