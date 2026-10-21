import type { CreateScanResponse } from '../../shared/contracts'
import type { NewScan, ScanRepository } from '../db/scan-repository'
import type { UsageRepository } from '../db/usage-repository'
import { parseRepositoryUrl } from '../domain/repository-url'
import type { ScanQueueSender } from './queue-message'

export type ScanLimits = {
  daily: number
  hourly: number
  cacheHours: number
  retentionDays: number
}

export type ScanServiceDependencies = {
  scans: Pick<
    ScanRepository,
    'deleteExpired' | 'findFreshByRepository' | 'create' | 'fail'
  >
  usage: Pick<UsageRepository, 'deleteExpired' | 'consume'>
  queue: ScanQueueSender
  now: () => Date
  newId: () => string
  hashClient: (address: string) => Promise<string>
  fullScan: boolean
  limits: ScanLimits
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

function nextUtcHour(date: Date): string {
  const next = new Date(date)
  next.setUTCMinutes(60, 0, 0)
  return next.toISOString()
}

function nextUtcDay(date: Date): string {
  const next = new Date(date)
  next.setUTCHours(24, 0, 0, 0)
  return next.toISOString()
}

export async function hashClientIdentifier(address: string): Promise<string> {
  const value = `supplytrace:v1:${address.trim() || 'unknown'}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export class ScanService {
  constructor(private readonly dependencies: ScanServiceDependencies) {}

  async createScan(input: {
    repositoryUrl: string
    clientAddress: string
  }): Promise<CreateScanResponse> {
    const parsedRepository = parseRepositoryUrl(input.repositoryUrl)
    const repository = this.dependencies.fullScan
      ? {
          ...parsedRepository,
          cacheKey: `${parsedRepository.cacheKey}:full`,
        }
      : parsedRepository
    const now = this.dependencies.now()
    const nowIso = now.toISOString()

    await Promise.all([
      this.dependencies.scans.deleteExpired(nowIso, 5),
      this.dependencies.usage.deleteExpired(nowIso, 20),
    ])

    const freshAfter = new Date(
      now.getTime() - this.dependencies.limits.cacheHours * 60 * 60 * 1000,
    ).toISOString()
    const fresh = await this.dependencies.scans.findFreshByRepository(
      repository.cacheKey,
      freshAfter,
    )

    if (fresh) {
      return {
        scanId: fresh.id,
        status: fresh.status,
        reused: true,
        resultUrl: `/scans/${fresh.id}`,
      }
    }

    if (!this.dependencies.fullScan) {
      const clientKey = await this.dependencies.hashClient(input.clientAddress)
      const hourBucket = `hour:${nowIso.slice(0, 13)}`
      const hourly = await this.dependencies.usage.consume(
        hourBucket,
        clientKey,
        this.dependencies.limits.hourly,
        nextUtcHour(now),
      )

      if (!hourly.allowed) {
        throw new ServiceError(
          'HOURLY_LIMIT_REACHED',
          'You have used all your checks for this hour. Try again next hour.',
          429,
        )
      }

      const dayBucket = `day:${nowIso.slice(0, 10)}`
      const daily = await this.dependencies.usage.consume(
        dayBucket,
        'global',
        this.dependencies.limits.daily,
        nextUtcDay(now),
      )

      if (!daily.allowed) {
        throw new ServiceError(
          'DAILY_LIMIT_REACHED',
          'All free checks for today have been used. Try again tomorrow.',
          429,
        )
      }
    }

    const scanId = this.dependencies.newId()
    const newScan: NewScan = {
      id: scanId,
      repository,
      createdAt: nowIso,
      expiresAt: new Date(
        now.getTime() + this.dependencies.limits.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }
    await this.dependencies.scans.create(newScan)

    try {
      await this.dependencies.queue.send({
        type: 'FETCH_SBOM',
        scanId,
        repositoryUrl: repository.url,
      })
    } catch {
      const message = 'We could not start the check. Try again in a few minutes.'
      await this.dependencies.scans.fail(scanId, 'QUEUE_UNAVAILABLE', message, nowIso)
      throw new ServiceError('QUEUE_UNAVAILABLE', message, 503)
    }

    return {
      scanId,
      status: 'queued',
      reused: false,
      resultUrl: `/scans/${scanId}`,
    }
  }
}
