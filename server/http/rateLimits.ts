// Limits on how often one IP address can call sensitive endpoints.
// Counts are kept in memory: exact for a single server (Replit), and per Worker
// instance on Cloudflare, where the limits are looser but still stop a runaway script.
import type { Request, RequestHandler } from 'express'
import { rateLimit, type Options } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from './errors'

/** The visitor's IP address: Cloudflare's header on Workers, otherwise what Express worked out. */
export function clientIp(req: Request): string {
  return (config.clientIpHeader && req.get(config.clientIpHeader)) || req.ip || 'unknown'
}

function limiter(perMinute: number, message: string): RequestHandler {
  const options: Partial<Options> = {
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: clientIp,
    skip: () => config.isTest, // tests log in many times in a few seconds
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', message)),
    // We create the limiter during the first request on purpose (see below), which this check would flag.
    validate: { creationStack: false },
  }
  // Created on first use rather than when this file loads: the in-memory store starts a
  // cleanup timer, and Cloudflare Workers don't allow timers outside a request.
  let handler: RequestHandler | undefined
  return (req, res, next) => {
    handler ??= rateLimit(options)
    return handler(req, res, next)
  }
}

export const loginLimiter = limiter(10, 'Too many sign-in attempts. Wait a minute and try again.')
export const webhookLimiter = limiter(60, 'Too many webhook calls. Slow down and retry.')
export const publicLimiter = limiter(120, 'Too many requests. Try again in a minute.')
