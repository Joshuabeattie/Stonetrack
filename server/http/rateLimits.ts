// Limits on how often one IP address can call sensitive endpoints.
// Counts are kept in memory, which is fine for a single server instance.
import { rateLimit, type Options } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from './errors'

function limiter(perMinute: number, message: string) {
  const options: Partial<Options> = {
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest, // tests log in many times in a few seconds
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', message)),
  }
  return rateLimit(options)
}

export const loginLimiter = limiter(10, 'Too many sign-in attempts. Wait a minute and try again.')
export const webhookLimiter = limiter(60, 'Too many webhook calls. Slow down and retry.')
export const publicLimiter = limiter(120, 'Too many requests. Try again in a minute.')
