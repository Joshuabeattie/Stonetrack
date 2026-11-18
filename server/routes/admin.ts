import { Router } from 'express'
import { idParam, userCreateSchema, userUpdateSchema } from '../../shared/schemas'
import { requireRole } from '../auth/middleware'
import { config } from '../config'
import { withTransaction } from '../db/pool'
import { seedDemoData } from '../db/seed'
import { forbidden } from '../http/errors'
import { parse } from '../http/validate'
import { createUser, listUsers, updateUser } from '../services/users'

// Mounted at the API root, so each route has its own admin guard (see planning.ts for why).
export const adminRoutes = Router()
const adminOnly = requireRole('admin')

// GET /api/users, POST /api/users { username, displayName, role, password }
adminRoutes.get('/users', adminOnly, async (_req, res) => {
  res.json(await listUsers())
})
adminRoutes.post('/users', adminOnly, async (req, res) => {
  res.status(201).json(await createUser(parse(userCreateSchema, req.body)))
})

// PATCH /api/users/:id { displayName?, role?, active?, password? }
adminRoutes.patch('/users/:id', adminOnly, async (req, res) => {
  res.json(await updateUser(parse(idParam, req.params.id), parse(userUpdateSchema, req.body), req.user!))
})

// POST /api/admin/reset-demo: put the demo data back (demo mode only). Signs everyone out.
adminRoutes.post('/admin/reset-demo', adminOnly, async (_req, res) => {
  if (!config.demoMode) throw forbidden('Resetting data is only available in demo mode')
  const summary = await withTransaction((client) => seedDemoData(client))
  res.json(summary)
})
