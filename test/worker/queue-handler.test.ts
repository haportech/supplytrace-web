import { env } from 'cloudflare:workers'
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../../src/server/services/dependencies'
import worker, { handleQueue } from '../../src/worker'

describe('queue handler', () => {
  it('drops queued work without creating a scanner when live scans are off', async () => {
    const batch = createMessageBatch('supplytrace-scans', [
      {
        id: 'disabled-message',
        timestamp: new Date('2026-08-06T14:00:00.000Z'),
        attempts: 1,
        body: {
          type: 'CHECK_OSV',
          scanId: 'disabled-scan',
          chunkIndex: 0,
          packageIds: [],
        },
      },
    ])
    const context = createExecutionContext()
    const scannerFactory = () => {
      throw new Error('scanner must not be created')
    }

    await handleQueue(
      batch,
      { ...env, GITHUB_TOKEN: undefined } as AppEnv,
      scannerFactory,
    )

    await expect(getQueueResult(batch, context)).resolves.toMatchObject({
      explicitAcks: ['disabled-message'],
      retryMessages: [],
    })
  })

  it('acknowledges a malformed internal message without processing it', async () => {
    const batch = createMessageBatch('supplytrace-scans', [
      {
        id: 'invalid-message',
        timestamp: new Date('2026-08-06T14:00:00.000Z'),
        attempts: 1,
        body: { type: 'BROKEN' },
      },
    ])
    const context = createExecutionContext()

    await worker.queue?.(batch, env, context)

    await expect(getQueueResult(batch, context)).resolves.toMatchObject({
      explicitAcks: ['invalid-message'],
      retryMessages: [],
    })
  })

  it('acknowledges a valid message whose scan no longer exists', async () => {
    const batch = createMessageBatch('supplytrace-scans', [
      {
        id: 'missing-scan-message',
        timestamp: new Date('2026-08-06T14:00:00.000Z'),
        attempts: 1,
        body: {
          type: 'CHECK_OSV',
          scanId: 'missing-scan',
          chunkIndex: 0,
          packageIds: [],
        },
      },
    ])
    const context = createExecutionContext()

    await worker.queue?.(batch, env, context)

    await expect(getQueueResult(batch, context)).resolves.toMatchObject({
      explicitAcks: ['missing-scan-message'],
      retryMessages: [],
    })
  })
})
