import { describe, expect, it } from 'vitest'

import { parsePackageUrl } from '../../src/server/domain/package-url'

describe('parsePackageUrl', () => {
  it.each([
    [
      'pkg:npm/react@19.2.0',
      { ecosystem: 'npm', name: 'react', version: '19.2.0' },
    ],
    [
      'pkg:npm/%40babel/core@7.28.0',
      { ecosystem: 'npm', name: '@babel/core', version: '7.28.0' },
    ],
    [
      'pkg:maven/org.apache.logging.log4j/log4j-core@2.17.0',
      {
        ecosystem: 'Maven',
        name: 'org.apache.logging.log4j:log4j-core',
        version: '2.17.0',
      },
    ],
    [
      'pkg:pypi/Django@5.0.1?download_url=example',
      { ecosystem: 'PyPI', name: 'Django', version: '5.0.1' },
    ],
    [
      'pkg:golang/github.com/gin-gonic/gin@v1.10.0',
      { ecosystem: 'Go', name: 'github.com/gin-gonic/gin', version: 'v1.10.0' },
    ],
  ])('normalizes %s for OSV', (purl, expected) => {
    expect(parsePackageUrl(purl)).toMatchObject(expected)
  })

  it('keeps a supported package that has no version', () => {
    expect(parsePackageUrl('pkg:cargo/serde')).toMatchObject({
      ecosystem: 'crates.io',
      name: 'serde',
      version: null,
    })
  })

  it.each([undefined, '', 'npm:react@19', 'pkg:unknown/name@1.0', 'pkg:npm/']) (
    'returns null for unsupported or malformed input: %s',
    (value) => {
      expect(parsePackageUrl(value)).toBeNull()
    },
  )
})

