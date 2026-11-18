import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { config } from '../config'
import { logger } from '../logger'
import { HttpError } from './errors'

/** Gives every request an id (returned in the X-Request-Id header) and logs it when it finishes. */
export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID()
  res.setHeader('X-Request-Id', req.requestId)
  const started = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const isApi = req.originalUrl.startsWith('/api')
    const meta = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      user: req.user?.username,
    }
    if (res.statusCode >= 500) logger.error('request failed', meta)
    else if (isApi) logger.info('request', meta)
    else logger.debug('request', meta) // static files: only in debug logs
  })
  next()
}

interface PgError {
  code: string
  detail?: string
  constraint?: string
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((err as PgError).code)
}

function statusCodeOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode
  return typeof status === 'number' ? status : undefined
}

/** Converts anything that was thrown into an HttpError we can send to the client. */
function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err

  // Errors from express.json() / express.raw() (body-parser)
  const type = (err as { type?: string })?.type
  if (type === 'entity.parse.failed') return new HttpError(400, 'BAD_REQUEST', 'The request body is not valid JSON')
  if (type === 'entity.too.large') return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large')

  // Database constraint errors that slipped past validation
  if (isPgError(err)) {
    if (err.code === '23505') return new HttpError(409, 'CONFLICT', 'That record already exists')
    if (err.code === '23503') return new HttpError(422, 'VALIDATION_ERROR', 'That refers to a record that does not exist')
    if (err.code === '23514') return new HttpError(422, 'VALIDATION_ERROR', 'That value is not allowed')
  }

  // Other library errors that carry a 4xx status (e.g. a missing static file)
  const status = statusCodeOf(err)
  if (status && status >= 400 && status < 500) {
    return new HttpError(status, status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', (err as Error).message || 'Bad request')
  }

  return new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Quote the request id if you report it.')
}

/** Express's final error handler. Every error response has the same JSON shape. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const httpError = toHttpError(err)
  if (httpError.status >= 500) {
    logger.error('Unhandled error', { requestId: req.requestId, method: req.method, path: req.originalUrl, error: err })
  }
  if (res.headersSent) return
  res.status(httpError.status).json({
    error: {
      code: httpError.code,
      message: httpError.message,
      details: httpError.details,
      requestId: req.requestId,
      // In development, show the real cause of a 500 to speed up debugging. Never in production.
      ...(httpError.status >= 500 && config.env === 'development' ? { debug: (err as Error)?.message } : {}),
    },
  })
}
