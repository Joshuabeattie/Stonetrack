import { Router } from 'express'
import { notFound } from '../http/errors'
import { publicLimiter } from '../http/rateLimits'
import { getPublicJobStatus } from '../services/jobs'

export const publicRoutes = Router()

// GET /api/public/jobs/:token: the client portal. No sign-in: the unguessable token is the key.
// It returns progress only (no notes, prices, people or slab details).
publicRoutes.get('/jobs/:token', publicLimiter, async (req, res) => {
  const token = String(req.params.token)
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound('Job')
  res.set('Cache-Control', 'no-store')
  res.json(await getPublicJobStatus(token))
})
