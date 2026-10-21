import type { ApiErrorResponse } from '../../shared/contracts'
import { RepositoryUrlError } from '../domain/repository-url'
import { ServiceError } from '../services/scan-service'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function publicApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof RepositoryUrlError) {
    return new ApiError(error.code, error.message, 400)
  }
  if (error instanceof ServiceError) {
    return new ApiError(error.code, error.message, error.status)
  }

  return new ApiError(
    'INTERNAL_ERROR',
    'Something went wrong. Try again in a few minutes.',
    500,
  )
}

export function apiErrorBody(error: ApiError): ApiErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  }
}
