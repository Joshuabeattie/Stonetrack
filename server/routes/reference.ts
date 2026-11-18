import { Router } from 'express'
import { idParam, machineUpdateSchema } from '../../shared/schemas'
import { FLOOR, STAFF, requireRole } from '../auth/middleware'
import { parse } from '../http/validate'
import { listClientNames, listMachines, listMaterials, listOperators, updateMachineHours } from '../services/reference'
import { listKioskJobs } from '../services/stages'

export const referenceRoutes = Router()

// GET /api/materials: stone types (for the intake form and stock screens).
referenceRoutes.get('/materials', requireRole(), async (_req, res) => {
  res.json(await listMaterials())
})

// GET /api/operators: factory workers the kiosk can credit work to.
referenceRoutes.get('/operators', requireRole(...FLOOR), async (_req, res) => {
  res.json(await listOperators())
})

// GET /api/clients: existing client names, used to suggest names on the intake form.
referenceRoutes.get('/clients', requireRole(...STAFF), async (_req, res) => {
  res.json(await listClientNames())
})

// GET /api/machines and PATCH /api/machines/:id { hoursPerDay } (admin): capacity settings.
referenceRoutes.get('/machines', requireRole(...STAFF), async (_req, res) => {
  res.json(await listMachines())
})
referenceRoutes.patch('/machines/:id', requireRole('admin'), async (req, res) => {
  const { hoursPerDay } = parse(machineUpdateSchema, req.body)
  res.json(await updateMachineHours(parse(idParam, req.params.id), hoursPerDay))
})

// GET /api/kiosk/jobs: every job still in the factory, for the kiosk screen.
referenceRoutes.get('/kiosk/jobs', requireRole(...FLOOR), async (_req, res) => {
  res.json(await listKioskJobs())
})
