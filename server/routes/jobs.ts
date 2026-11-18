import { Router } from 'express'
import {
  advanceStageSchema,
  allocateSlabsSchema,
  idParam,
  jobInputSchema,
  jobListQuerySchema,
  jobUpdateSchema,
  remakeSchema,
} from '../../shared/schemas'
import { FLOOR, STAFF, requireRole } from '../auth/middleware'
import { parse } from '../http/validate'
import { createJob, getJobDetail, listJobs, regenerateShareToken, updateJob } from '../services/jobs'
import { allocateToJob } from '../services/slabs'
import { advanceJob, flagRemake } from '../services/stages'

export const jobRoutes = Router()

// GET /api/jobs?status=active|dispatched|all&stage=&q=&due=overdue|this_week
jobRoutes.get('/', requireRole(...STAFF), async (req, res) => {
  res.json(await listJobs(parse(jobListQuerySchema, req.query)))
})

// POST /api/jobs: job intake. Returns the full job, including the generated cutting list.
jobRoutes.post('/', requireRole(...STAFF), async (req, res) => {
  const input = parse(jobInputSchema, req.body)
  const id = await createJob(input, { source: 'manual', userId: req.user!.id })
  res.status(201).location(`/api/jobs/${id}`).json(await getJobDetail(id))
})

// GET /api/jobs/:id: everything about one job (pieces, cutting list, history, slabs).
jobRoutes.get('/:id', requireRole(...STAFF), async (req, res) => {
  res.json(await getJobDetail(parse(idParam, req.params.id)))
})

// PATCH /api/jobs/:id  { dueDate?, priority?, notes?, siteAddress? }
jobRoutes.patch('/:id', requireRole(...STAFF), async (req, res) => {
  res.json(await updateJob(parse(idParam, req.params.id), parse(jobUpdateSchema, req.body)))
})

// POST /api/jobs/:id/advance  { expectedStage, operatorId?, labourHours?, note? }
// Used by the kiosk and the job page. 409 if the job has moved on since the caller looked.
jobRoutes.post('/:id/advance', requireRole(...FLOOR), async (req, res) => {
  res.json(await advanceJob(parse(idParam, req.params.id), parse(advanceStageSchema, req.body), req.user!))
})

// POST /api/jobs/:id/remake  { expectedStage, reason, pieceId?, operatorId?, note? }
jobRoutes.post('/:id/remake', requireRole(...FLOOR), async (req, res) => {
  res.json(await flagRemake(parse(idParam, req.params.id), parse(remakeSchema, req.body), req.user!))
})

// POST /api/jobs/:id/allocate  { slabIds? }  (no slabIds = allocate automatically)
jobRoutes.post('/:id/allocate', requireRole(...STAFF), async (req, res) => {
  const { slabIds } = parse(allocateSlabsSchema, req.body ?? {})
  res.json(await allocateToJob(parse(idParam, req.params.id), slabIds))
})

// POST /api/jobs/:id/share-token: new client link (the old link stops working).
jobRoutes.post('/:id/share-token', requireRole(...STAFF), async (req, res) => {
  res.json({ shareToken: await regenerateShareToken(parse(idParam, req.params.id)) })
})
