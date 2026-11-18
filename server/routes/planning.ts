import { Router } from 'express'
import { capacityQuerySchema, kpiQuerySchema } from '../../shared/schemas'
import { STAFF, requireRole } from '../auth/middleware'
import { parse } from '../http/validate'
import { getCapacityPlan } from '../services/capacity'
import { getKpis } from '../services/kpis'

// Mounted at the API root, so each route has its own guard. (A router-wide
// `planningRoutes.use(requireRole(...))` would also catch every other URL that
// reaches this router, turning unknown routes into 401s instead of 404s.)
export const planningRoutes = Router()

// GET /api/capacity?days=10: machine and labour hours per day, and jobs at risk.
planningRoutes.get('/capacity', requireRole(...STAFF), async (req, res) => {
  const { days } = parse(capacityQuerySchema, req.query)
  res.json(await getCapacityPlan(days))
})

// GET /api/kpis?days=30: throughput, lead time, remakes, waste, labour productivity.
planningRoutes.get('/kpis', requireRole(...STAFF), async (req, res) => {
  const { days } = parse(kpiQuerySchema, req.query)
  res.json(await getKpis(days))
})
