import { createApp } from './server/api/app'
import {
  createScanWorker,
  liveScansEnabled,
  type AppEnv,
} from './server/services/dependencies'
import {
  isScanQueueMessage,
  type ScanQueueMessage,
} from './server/services/queue-message'

const app = createApp()

type ScannerFactory = typeof createScanWorker

export async function handleQueue(
  batch: MessageBatch<ScanQueueMessage>,
  env: AppEnv,
  scannerFactory: ScannerFactory = createScanWorker,
): Promise<void> {
  if (!liveScansEnabled(env)) {
    for (const message of batch.messages) message.ack()
    return
  }

  const scanner = scannerFactory(env, caches.default)

  for (const message of batch.messages) {
    if (!isScanQueueMessage(message.body)) {
      message.ack()
      continue
    }

    const decision = await scanner.process(message.body, message.attempts)
    if (decision.action === 'retry') {
      message.retry({ delaySeconds: decision.delaySeconds })
    } else {
      message.ack()
    }
  }
}

const worker: ExportedHandler<AppEnv, ScanQueueMessage> = {
  fetch: app.fetch,
  async queue(batch, env) {
    await handleQueue(batch, env)
  },
}

export default worker
