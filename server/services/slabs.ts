// Slab stock: what's in the yard, receiving new slabs, and allocating slabs to jobs.
import type pg from 'pg'
import type { MaterialStock, Slab } from '../../shared/types'
import { MATERIAL_COLUMNS, SLAB_SQL, toMaterial, toSlab, type MaterialRow, type SlabRow } from '../db/mappers'
import { query, withTransaction, type Db } from '../db/pool'
import { conflict, notFound, validationError } from '../http/errors'
import { loadJobPlans } from './jobs'
import { getMaterial } from './reference'

export async function listSlabs(filters: { status?: string; materialId?: number }): Promise<Slab[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.status) {
    params.push(filters.status)
    where.push(`s.status = $${params.length}`)
  }
  if (filters.materialId) {
    params.push(filters.materialId)
    where.push(`s.material_id = $${params.length}`)
  }
  const rows = await query<SlabRow>(
    `${SLAB_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE s.status WHEN 'available' THEN 0 WHEN 'allocated' THEN 1 ELSE 2 END, m.name, s.code
     LIMIT 500`,
    params,
  )
  return rows.map(toSlab)
}

/** Stock level per stone: a stone is "low" when available slabs are at or below its reorder level. */
export async function stockLevels(): Promise<MaterialStock[]> {
  const rows = await query<MaterialRow & { available: number; allocated: number; consumed_30: number }>(
    `SELECT ${MATERIAL_COLUMNS},
            count(s.id) FILTER (WHERE s.status = 'available')::int AS available,
            count(s.id) FILTER (WHERE s.status = 'allocated')::int AS allocated,
            count(s.id) FILTER (WHERE s.status = 'consumed' AND s.consumed_at > now() - interval '30 days')::int AS consumed_30
       FROM materials m
       LEFT JOIN slabs s ON s.material_id = m.id
      WHERE m.active
      GROUP BY m.id
      ORDER BY m.material_type, m.name`,
  )
  return rows.map((r) => ({
    ...toMaterial(r),
    available: r.available,
    allocated: r.allocated,
    consumedLast30Days: r.consumed_30,
    lowStock: r.available <= r.reorder_level,
  }))
}

/** Booking in a delivery: one row per slab, at the stone's standard slab size. */
export async function receiveSlabs(input: { materialId: number; quantity: number; rackLocation?: string }): Promise<Slab[]> {
  const material = await getMaterial(input.materialId)
  if (!material) throw validationError([{ path: 'materialId', message: 'Choose a stone from the list' }])
  const ids: { id: number }[] = []
  for (let i = 0; i < input.quantity; i++) {
    const rows = await query<{ id: number }>(
      'INSERT INTO slabs (material_id, length_mm, width_mm, rack_location) VALUES ($1, $2, $3, $4) RETURNING id',
      [material.id, material.slabLengthMm, material.slabWidthMm, input.rackLocation ?? null],
    )
    ids.push(rows[0])
  }
  const rows = await query<SlabRow>(`${SLAB_SQL} WHERE s.id = ANY($1::int[]) ORDER BY s.id`, [ids.map((r) => r.id)])
  return rows.map(toSlab)
}

interface JobForAllocation {
  id: number
  job_number: string
  material_id: number
  material_name: string
  current_stage: string
}

async function lockJob(tx: pg.PoolClient, jobId: number): Promise<JobForAllocation> {
  const [job] = await query<JobForAllocation>(
    `SELECT j.id, j.job_number, j.material_id, m.name AS material_name, j.current_stage
       FROM jobs j JOIN materials m ON m.id = j.material_id
      WHERE j.id = $1
      FOR UPDATE OF j`,
    [jobId],
    tx,
  )
  if (!job) throw notFound('Job')
  return job
}

/**
 * Allocates however many slabs the job is still short of, oldest stock first (FIFO).
 * `FOR UPDATE SKIP LOCKED` means two jobs being allocated at the same moment can never
 * grab the same slab. Throws 409 INSUFFICIENT_STOCK if the yard doesn't have enough.
 */
export async function allocateShortfall(db: Db, job: JobForAllocation, slabsRequired: number): Promise<string[]> {
  const [{ have }] = await query<{ have: number }>('SELECT count(*)::int AS have FROM slabs WHERE job_id = $1', [job.id], db)
  const shortfall = slabsRequired - have
  if (shortfall <= 0) return []

  const picked = await query<{ id: number; code: string }>(
    `SELECT id, code FROM slabs
      WHERE material_id = $1 AND status = 'available'
      ORDER BY received_at, id
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [job.material_id, shortfall],
    db,
  )
  if (picked.length < shortfall) {
    throw conflict(
      `Not enough stock: ${job.job_number} needs ${shortfall} more ${job.material_name} slab${shortfall === 1 ? '' : 's'} ` +
        `but only ${picked.length} ${picked.length === 1 ? 'is' : 'are'} available. Receive more slabs first.`,
      'INSUFFICIENT_STOCK',
    )
  }
  await query(
    `UPDATE slabs SET status = 'allocated', job_id = $1, allocated_at = now() WHERE id = ANY($2::int[])`,
    [job.id, picked.map((s) => s.id)],
    db,
  )
  return picked.map((s) => s.code)
}

/** Manager action: allocate specific slabs, or (no slabIds) top up automatically to what the cutting list needs. */
export async function allocateToJob(jobId: number, slabIds?: number[]): Promise<{ allocated: string[] }> {
  return withTransaction(async (tx) => {
    const job = await lockJob(tx, jobId)
    if (job.current_stage === 'dispatched') throw conflict(`${job.job_number} has already been dispatched`)

    if (!slabIds) {
      const plan = (await loadJobPlans([jobId], tx)).get(jobId)
      const required = plan?.cuttingList.totals.slabsRequired ?? 0
      const allocated = await allocateShortfall(tx, job, required)
      if (allocated.length === 0) {
        throw conflict(
          `${job.job_number} already has the ${required} slab${required === 1 ? '' : 's'} its cutting list needs. Choose a specific slab to add another.`,
          'ALREADY_ALLOCATED',
        )
      }
      return { allocated }
    }

    const slabs = await query<{ id: number; code: string; status: string; material_id: number }>(
      'SELECT id, code, status, material_id FROM slabs WHERE id = ANY($1::int[]) FOR UPDATE',
      [slabIds],
      tx,
    )
    for (const id of slabIds) {
      const slab = slabs.find((s) => s.id === id)
      if (!slab) throw notFound(`Slab ${id}`)
      if (slab.material_id !== job.material_id) {
        throw validationError([{ path: 'slabIds', message: `${slab.code} is a different stone from ${job.job_number} (${job.material_name})` }])
      }
      if (slab.status !== 'available') throw conflict(`${slab.code} is already ${slab.status}`, 'SLAB_UNAVAILABLE')
    }
    await query(`UPDATE slabs SET status = 'allocated', job_id = $1, allocated_at = now() WHERE id = ANY($2::int[])`, [jobId, slabIds], tx)
    return { allocated: slabs.map((s) => s.code) }
  })
}

/** Puts an allocated (not yet cut) slab back into stock. */
export async function releaseSlab(slabId: number): Promise<Slab> {
  const rows = await query<{ id: number; status: string }>('SELECT id, status FROM slabs WHERE id = $1', [slabId])
  if (!rows[0]) throw notFound('Slab')
  if (rows[0].status !== 'allocated') {
    throw conflict(
      rows[0].status === 'consumed' ? 'This slab has already been cut and cannot be released' : 'This slab is not allocated to a job',
      'SLAB_NOT_ALLOCATED',
    )
  }
  await query(`UPDATE slabs SET status = 'available', job_id = NULL, allocated_at = NULL WHERE id = $1`, [slabId])
  const [slab] = await query<SlabRow>(`${SLAB_SQL} WHERE s.id = $1`, [slabId])
  return toSlab(slab)
}
