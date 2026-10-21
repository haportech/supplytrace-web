import { Hono } from 'hono'

import type { ScanRepository } from '../db/scan-repository'
import { ScanRepository as D1ScanRepository } from '../db/scan-repository'
import {
  createScanService,
  liveScansEnabled,
  type AppEnv,
} from '../services/dependencies'
import type { ScanService } from '../services/scan-service'
import { ApiError, apiErrorBody, publicApiError } from './errors'
import {
  assertSameOrigin,
  clientAddress,
  isScanId,
  jsonResponse,
  readJsonObject,
} from './response'

export type ApiDependencies = {
  scanService: (env: AppEnv) => Pick<ScanService, 'createScan'>
  scanResults: (env: AppEnv) => Pick<ScanRepository, 'getResult'>
}

const defaultDependencies: ApiDependencies = {
  scanService: createScanService,
  scanResults: (env) => new D1ScanRepository(env.DB),
}

export function createApp(dependencies: ApiDependencies = defaultDependencies) {
  const app = new Hono<{ Bindings: AppEnv }>()

  app.onError((error) => {
    const publicError = publicApiError(error)
    return jsonResponse(apiErrorBody(publicError), publicError.status)
  })

  app.get('/api/health', (context) =>
    jsonResponse({
      status: 'ok',
      service: 'supplytrace',
      version: context.env.APP_VERSION,
      liveScansEnabled: liveScansEnabled(context.env),
    }),
  )

  app.post('/api/scans', async (context) => {
    if (!liveScansEnabled(context.env)) {
      throw new ApiError(
        'LIVE_SCANS_DISABLED',
        'Live checks are off on this public demo. Run SupplyTrace on your computer with your own GitHub key.',
        403,
      )
    }

    assertSameOrigin(context.req.raw)
    const body = await readJsonObject(context.req.raw)

    if (typeof body.repositoryUrl !== 'string') {
      throw new ApiError(
        'INVALID_REQUEST',
        'Enter a public GitHub project link.',
        400,
      )
    }

    const created = await dependencies.scanService(context.env).createScan({
      repositoryUrl: body.repositoryUrl,
      clientAddress: clientAddress(context.req.raw),
    })

    return jsonResponse(created, created.reused ? 200 : 202, {
      location: created.resultUrl,
    })
  })

  app.get('/api/scans/:scanId', async (context) => {
    const scanId = context.req.param('scanId')
    if (!isScanId(scanId)) {
      throw new ApiError('SCAN_NOT_FOUND', 'We could not find that check.', 404)
    }

    const result = await dependencies.scanResults(context.env).getResult(scanId)
    if (!result) {
      throw new ApiError('SCAN_NOT_FOUND', 'We could not find that check.', 404)
    }

    return jsonResponse(result)
  })

  app.all('/api/*', () =>
    jsonResponse(
      apiErrorBody(
        new ApiError('API_NOT_FOUND', 'We could not find that API page.', 404),
      ),
      404,
    ),
  )

  return app
}
