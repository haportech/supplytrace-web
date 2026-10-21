import kevFixture from '../fixtures/cisa-kev.json'
import { describe, expect, it } from 'vitest'

import { KevClient, matchKev } from '../../src/server/clients/kev'
import { createFetchQueue, jsonResponse } from '../helpers/fetch'

describe('KevClient', () => {
  it('normalizes the CISA catalog by CVE', async () => {
    const { fetcher, calls } = createFetchQueue([jsonResponse(kevFixture)])
    const catalog = await new KevClient({ fetcher }).load()

    expect(String(calls[0].input)).toBe(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    )
    expect(catalog.get('CVE-2020-28500')).toEqual({
      cveId: 'CVE-2020-28500',
      dueDate: '2026-08-20',
      knownRansomwareUse: true,
      evidenceUrls: [
        'https://www.cisa.gov/example',
        'https://nvd.nist.gov/vuln/detail/CVE-2020-28500',
      ],
    })
    expect(catalog.get('CVE-2026-99999')?.knownRansomwareUse).toBeNull()
  })

  it('matches aliases case-insensitively', async () => {
    const { fetcher } = createFetchQueue([jsonResponse(kevFixture)])
    const catalog = await new KevClient({ fetcher }).load()

    expect(matchKev(catalog, ['GHSA-test', 'cve-2020-28500'])).toMatchObject({
      cveId: 'CVE-2020-28500',
    })
    expect(matchKev(catalog, ['CVE-2000-0000'])).toBeNull()
  })
})

