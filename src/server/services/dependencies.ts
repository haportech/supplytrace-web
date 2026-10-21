import { GitHubClient } from '../clients/github'
import { KevClient } from '../clients/kev'
import { OsvClient } from '../clients/osv'
import { ScanRepository } from '../db/scan-repository'
import { UsageRepository } from '../db/usage-repository'
import {
  MAX_FINDINGS_PER_SCAN,
  type ScanQueueMessage,
  type ScanQueueSender,
} from './queue-message'
import {
  hashClientIdentifier,
  ScanService,
  type ScanLimits,
} from './scan-service'
import { ScanWorker } from './scan-worker'

export type AppEnv = {
  DB: D1Database
  SCAN_QUEUE: Queue<ScanQueueMessage>
  APP_VERSION: string
  SCAN_LIMIT_DAILY: string
  SCAN_LIMIT_HOURLY: string
  SCAN_CACHE_HOURS: string
  SCAN_RETENTION_DAYS: string
  GITHUB_TOKEN?: string
  LOCAL_FULL_SCAN?: string
}

export function liveScansEnabled(
  env: Pick<AppEnv, 'GITHUB_TOKEN'>,
): boolean {
  return (
    typeof env.GITHUB_TOKEN === 'string' &&
    env.GITHUB_TOKEN.trim().length > 0
  )
}

export function localFullScanEnabled(
  env: Pick<AppEnv, 'GITHUB_TOKEN' | 'LOCAL_FULL_SCAN'>,
): boolean {
  return liveScansEnabled(env) && env.LOCAL_FULL_SCAN?.trim() === 'true'
}

function boundedInteger(value: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback
}

export function scanLimits(env: AppEnv): ScanLimits {
  return {
    daily: boundedInteger(env.SCAN_LIMIT_DAILY, 20, 20),
    hourly: boundedInteger(env.SCAN_LIMIT_HOURLY, 3, 3),
    cacheHours: boundedInteger(env.SCAN_CACHE_HOURS, 6, 24),
    retentionDays: boundedInteger(env.SCAN_RETENTION_DAYS, 30, 30),
  }
}

function queueSender(queue: Queue<ScanQueueMessage>): ScanQueueSender {
  return {
    send: async (body) => {
      await queue.send(body)
    },
    sendBatch: async (messages) => {
      await queue.sendBatch(messages)
    },
  }
}

export function createScanService(env: AppEnv): ScanService {
  return new ScanService({
    scans: new ScanRepository(env.DB),
    usage: new UsageRepository(env.DB),
    queue: queueSender(env.SCAN_QUEUE),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    hashClient: hashClientIdentifier,
    fullScan: localFullScanEnabled(env),
    limits: scanLimits(env),
  })
}

export function createScanWorker(env: AppEnv, cache?: Cache): ScanWorker {
  const fullScan = localFullScanEnabled(env)

  return new ScanWorker({
    scans: new ScanRepository(env.DB),
    github: new GitHubClient({ token: env.GITHUB_TOKEN, fullScan }),
    osv: new OsvClient({ fullScan }),
    kev: new KevClient(),
    queue: queueSender(env.SCAN_QUEUE),
    maxFindings: fullScan ? null : MAX_FINDINGS_PER_SCAN,
    cache,
    now: () => new Date(),
  })
}
