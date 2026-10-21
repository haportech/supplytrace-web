export const OSV_PACKAGES_PER_CHUNK = 20
export const MAX_FINDINGS_PER_SCAN = 600

export type ScanQueueMessage =
  | {
      type: 'FETCH_SBOM'
      scanId: string
      repositoryUrl: string
    }
  | {
      type: 'CHECK_OSV'
      scanId: string
      chunkIndex: number
      packageIds: string[]
    }

export type QueueSendRequest = {
  body: ScanQueueMessage
}

export interface ScanQueueSender {
  send(body: ScanQueueMessage): Promise<void>
  sendBatch(messages: Iterable<QueueSendRequest>): Promise<void>
}

export function isScanQueueMessage(value: unknown): value is ScanQueueMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<ScanQueueMessage>

  if (
    typeof message.scanId !== 'string' ||
    message.scanId.length === 0 ||
    message.scanId.length > 100
  ) {
    return false
  }

  if (message.type === 'FETCH_SBOM') {
    return (
      typeof message.repositoryUrl === 'string' &&
      message.repositoryUrl.length > 0 &&
      message.repositoryUrl.length <= 200
    )
  }

  if (message.type === 'CHECK_OSV') {
    return (
      Number.isInteger(message.chunkIndex) &&
      Number(message.chunkIndex) >= 0 &&
      Array.isArray(message.packageIds) &&
      message.packageIds.length <= OSV_PACKAGES_PER_CHUNK &&
      message.packageIds.every(
        (id) => typeof id === 'string' && id.length > 0 && id.length <= 260,
      )
    )
  }

  return false
}
