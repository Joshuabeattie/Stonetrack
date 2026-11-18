import { Router } from 'express'
import type { Meta } from '../../shared/types'
import { config } from '../config'
import { query } from '../db/pool'
import { DEMO_ACCOUNTS } from '../db/seed'

export const metaRoutes = Router()

// GET /api/meta: public settings the React app needs before anyone signs in.
metaRoutes.get('/meta', (_req, res) => {
  const body: Meta = {
    appName: 'StoneTrack',
    factoryName: config.factoryName,
    timezone: config.factoryTimezone,
    environment: config.env,
    demoMode: config.demoMode,
    demoAccounts: config.demoMode ? DEMO_ACCOUNTS : [],
  }
  res.json(body)
})

// GET /api/health: for uptime checks. 503 if the database can't be reached.
metaRoutes.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1')
    res.json({ ok: true, database: 'up', environment: config.env })
  } catch {
    res.status(503).json({ ok: false, database: 'down', environment: config.env })
  }
})
