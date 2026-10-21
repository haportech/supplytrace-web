import { describe, expect, it } from 'vitest'

import {
  RepositoryUrlError,
  parseRepositoryUrl,
} from '../../src/server/domain/repository-url'

describe('parseRepositoryUrl', () => {
  it('returns a canonical public GitHub repository', () => {
    expect(parseRepositoryUrl('https://github.com/OpenAI/openai-node/')).toEqual({
      owner: 'OpenAI',
      repository: 'openai-node',
      fullName: 'OpenAI/openai-node',
      cacheKey: 'openai/openai-node',
      url: 'https://github.com/OpenAI/openai-node',
    })
  })

  it('removes a git suffix', () => {
    expect(parseRepositoryUrl('https://github.com/cloudflare/workers-sdk.git').url).toBe(
      'https://github.com/cloudflare/workers-sdk',
    )
  })

  it.each([
    'http://github.com/openai/openai-node',
    'https://example.com/openai/openai-node',
    'https://github.com/openai/openai-node/issues',
    'https://github.com/openai/openai-node?tab=readme',
    'https://user@github.com/openai/openai-node',
    'git@github.com:openai/openai-node.git',
    'https://github.com/-owner/repository',
    'https://github.com/owner/.',
    `https://github.com/owner/${'a'.repeat(181)}`,
  ])('rejects unsafe or unsupported input: %s', (value) => {
    expect(() => parseRepositoryUrl(value)).toThrow(RepositoryUrlError)
  })
})

