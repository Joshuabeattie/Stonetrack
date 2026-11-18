import { Router } from 'express'
import { idParam, receiveSlabsSchema, slabListQuerySchema } from '../../shared/schemas'
import { STAFF, requireRole } from '../auth/middleware'
import { parse } from '../http/validate'
import { listSlabs, receiveSlabs, releaseSlab, stockLevels } from '../services/slabs'

export const slabRoutes = Router()
slabRoutes.use(requireRole(...STAFF))

// GET /api/slabs?status=available|allocated|consumed&materialId=
slabRoutes.get('/', async (req, res) => {
  res.json(await listSlabs(parse(slabListQuerySchema, req.query)))
})

// GET /api/slabs/stock: stock level per stone, with low-stock flags.
slabRoutes.get('/stock', async (_req, res) => {
  res.json(await stockLevels())
})

// POST /api/slabs  { materialId, quantity, rackLocation? }: book in a delivery.
slabRoutes.post('/', async (req, res) => {
  res.status(201).json(await receiveSlabs(parse(receiveSlabsSchema, req.body)))
})

// POST /api/slabs/:id/release: return an allocated, uncut slab to stock.
slabRoutes.post('/:id/release', async (req, res) => {
  res.json(await releaseSlab(parse(idParam, req.params.id)))
})
