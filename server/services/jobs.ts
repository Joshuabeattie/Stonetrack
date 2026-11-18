// Jobs: intake, lists, detail, edits and the client share link.
// Stage changes (advance / remake) live in stages.ts.
import { randomBytes } from 'node:crypto'
import { generateCuttingList, type CuttingList, type PieceSpec } from '../../shared/cuttingList'
import { addDays, todayInZone } from '../../shared/dates'
import type { JobInput, JobUpdate } from '../../shared/schemas'
import { STAGES, STAGE_LABELS, stageIndex, type Stage } from '../../shared/stages'
import type { JobDetail, JobSummary, Material, PublicJobStatus } from '../../shared/types'
import { config } from '../config'
import { insertRows } from '../db/insert'
import {
  JOB_SUMMARY_SQL,
  SLAB_SQL,
  STAGE_EVENT_SQL,
  toJobSummary,
  toMaterialSpec,
  toPiece,
  toSlab,
  toStageEvent,
  type JobSummaryRow,
  type PieceRow,
  type SlabRow,
  type StageEventRow,
} from '../db/mappers'
import { getPool, query, withTransaction, type Db } from '../db/pool'
import { conflict, notFound, validationError } from '../http/errors'
import { getMaterial } from './reference'

/** 18 random bytes → a 24-character URL-safe token. Unguessable, so the link itself is the key. */
export function newShareToken(): string {
  return randomBytes(18).toString('base64url')
}

export function factoryToday(): string {
  return todayInZone(config.factoryTimezone)
}

function assertDueDateNotPast(dueDate: string) {
  const today = factoryToday()
  if (dueDate < today) {
    throw validationError([{ path: 'dueDate', message: `The due date can't be in the past (today is ${today})` }])
  }
}

/**
 * Builds the cutting list and rejects pieces that can't fit on a single slab of the
 * chosen stone (they would need to be split into two pieces with a join).
 */
export function cuttingListOrThrow(pieces: PieceSpec[], material: Material): CuttingList {
  const list = generateCuttingList(pieces, toMaterialSpec(material))
  if (list.oversize.length > 0) {
    const usable = `${list.usableSlab.lengthMm} × ${list.usableSlab.widthMm} mm`
    const reported = new Set<number>()
    const details = list.oversize
      .filter((item) => !reported.has(item.pieceIndex) && reported.add(item.pieceIndex))
      .map((item) => ({
        path: `pieces.${item.pieceIndex}.lengthMm`,
        message: `${item.pieceName} (${item.lengthMm} × ${item.widthMm} mm) won't fit on one ${material.name} slab (usable area ${usable}). Split it into two pieces with a join.`,
      }))
    throw validationError(details, 'Some pieces are larger than a slab')
  }
  return list
}

async function findOrCreateClient(db: Db, name: string, email?: string, phone?: string): Promise<number> {
  const existing = await query<{ id: number }>('SELECT id FROM clients WHERE lower(name) = lower($1)', [name], db)
  if (existing[0]) {
    if (email || phone) {
      await query('UPDATE clients SET email = COALESCE($2, email), phone = COALESCE($3, phone) WHERE id = $1', [
        existing[0].id,
        email ?? null,
        phone ?? null,
      ], db)
    }
    return existing[0].id
  }
  const created = await query<{ id: number }>('INSERT INTO clients (name, email, phone) VALUES ($1, $2, $3) RETURNING id', [
    name,
    email ?? null,
    phone ?? null,
  ], db)
  return created[0].id
}

export interface CreateJobOptions {
  source: 'manual' | 'webhook'
  userId?: number | null
  externalRef?: string
}

/**
 * Job intake, used by both the New Job form and the order webhook.
 * Everything happens in one transaction: client, job, pieces and the first history event.
 */
export async function createJob(input: JobInput, options: CreateJobOptions): Promise<number> {
  assertDueDateNotPast(input.dueDate)
  return withTransaction(async (tx) => {
    const material = await getMaterial(input.materialId, tx)
    if (!material) throw validationError([{ path: 'materialId', message: 'Choose a stone from the list' }])
    cuttingListOrThrow(input.pieces, material)

    const clientId = await findOrCreateClient(tx, input.clientName, input.clientEmail, input.clientPhone)
    const [job] = await query<{ id: number }>(
      `INSERT INTO jobs (client_id, material_id, site_address, drawing_ref, due_date, priority, notes,
                         share_token, source, external_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        clientId,
        material.id,
        input.siteAddress ?? null,
        input.drawingRef,
        input.dueDate,
        input.priority,
        input.notes ?? null,
        newShareToken(),
        options.source,
        options.externalRef ?? null,
        options.userId ?? null,
      ],
      tx,
    )

    await insertRows(
      tx,
      'job_pieces',
      ['job_id', 'piece_no', 'name', 'length_mm', 'width_mm', 'quantity', 'edge_profile', 'polished_edges', 'cutouts'],
      input.pieces.map((p, i) => [job.id, i + 1, p.name, p.lengthMm, p.widthMm, p.quantity, p.edgeProfile, p.polishedEdges, p.cutouts]),
    )

    await query(
      `INSERT INTO stage_events (job_id, event_type, to_stage, user_id, note)
       VALUES ($1, 'created', 'slab_allocation', $2, $3)`,
      [job.id, options.userId ?? null, options.source === 'webhook' ? `Received by webhook (order ${options.externalRef})` : null],
      tx,
    )
    return job.id
  })
}

export interface JobFilters {
  status: 'active' | 'dispatched' | 'all'
  stage?: Stage
  q?: string
  due?: 'overdue' | 'this_week'
}

export async function listJobs(filters: JobFilters): Promise<JobSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }

  if (filters.status === 'active') where.push(`j.current_stage <> 'dispatched'`)
  if (filters.status === 'dispatched') where.push(`j.current_stage = 'dispatched'`)
  if (filters.stage) where.push(`j.current_stage = ${param(filters.stage)}`)
  if (filters.q) {
    // Escape LIKE wildcards so a search for "50%" means the text "50%".
    const pattern = param(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`)
    where.push(`(j.job_number ILIKE ${pattern} OR c.name ILIKE ${pattern} OR j.drawing_ref ILIKE ${pattern})`)
  }
  const today = factoryToday()
  if (filters.due === 'overdue') where.push(`j.due_date < ${param(today)} AND j.current_stage <> 'dispatched'`)
  if (filters.due === 'this_week') where.push(`j.due_date BETWEEN ${param(today)} AND ${param(addDays(today, 7))}`)

  const order =
    filters.status === 'dispatched'
      ? 'j.dispatched_at DESC'
      : filters.status === 'all'
        ? 'j.created_at DESC'
        : `j.due_date ASC, (j.priority = 'urgent') DESC, j.id ASC`

  const rows = await query<JobSummaryRow>(
    `${JOB_SUMMARY_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 200`,
    params,
  )
  return rows.map(toJobSummary)
}

/** Pieces, material and cutting list for a set of jobs, in three queries however many jobs there are. */
export async function loadJobPlans(jobIds: number[], db: Db = getPool()) {
  const plans = new Map<number, { material: Material; pieces: ReturnType<typeof toPiece>[]; cuttingList: CuttingList }>()
  if (jobIds.length === 0) return plans
  const jobRows = await query<{ id: number; material_id: number }>('SELECT id, material_id FROM jobs WHERE id = ANY($1::int[])', [jobIds], db)
  const pieceRows = await query<PieceRow & { job_id: number }>(
    `SELECT job_id, id, piece_no, name, length_mm, width_mm, quantity, edge_profile, polished_edges, cutouts
       FROM job_pieces WHERE job_id = ANY($1::int[]) ORDER BY job_id, piece_no`,
    [jobIds],
    db,
  )
  const materials = new Map<number, Material>()
  for (const materialId of new Set(jobRows.map((j) => j.material_id))) {
    const material = await getMaterial(materialId, db)
    if (material) materials.set(materialId, material)
  }
  for (const job of jobRows) {
    const material = materials.get(job.material_id)
    if (!material) continue
    const pieces = pieceRows.filter((p) => p.job_id === job.id).map(toPiece)
    plans.set(job.id, { material, pieces, cuttingList: generateCuttingList(pieces, toMaterialSpec(material)) })
  }
  return plans
}

export async function getJobDetail(id: number, db: Db = getPool()): Promise<JobDetail> {
  const [summary] = await query<JobSummaryRow>(`${JOB_SUMMARY_SQL} WHERE j.id = $1`, [id], db)
  if (!summary) throw notFound('Job')
  const [extra] = await query<{
    site_address: string | null
    drawing_ref: string
    notes: string | null
    client_email: string | null
    client_phone: string | null
    external_ref: string | null
    created_by_name: string | null
    share_token: string
  }>(
    `SELECT j.site_address, j.drawing_ref, j.notes, c.email AS client_email, c.phone AS client_phone,
            j.external_ref, u.display_name AS created_by_name, j.share_token
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
       LEFT JOIN users u ON u.id = j.created_by
      WHERE j.id = $1`,
    [id],
    db,
  )
  const plan = (await loadJobPlans([id], db)).get(id)
  if (!plan) throw notFound('Job material')
  const events = await query<StageEventRow>(`${STAGE_EVENT_SQL} WHERE e.job_id = $1 ORDER BY e.created_at, e.id`, [id], db)
  const slabs = await query<SlabRow>(`${SLAB_SQL} WHERE s.job_id = $1 ORDER BY s.code`, [id], db)

  return {
    ...toJobSummary(summary),
    siteAddress: extra.site_address,
    drawingRef: extra.drawing_ref,
    notes: extra.notes,
    clientEmail: extra.client_email,
    clientPhone: extra.client_phone,
    externalRef: extra.external_ref,
    createdByName: extra.created_by_name,
    shareToken: extra.share_token,
    material: plan.material,
    pieces: plan.pieces,
    cuttingList: plan.cuttingList,
    events: events.map(toStageEvent),
    slabs: slabs.map(toSlab),
  }
}

export async function updateJob(id: number, patch: JobUpdate): Promise<JobDetail> {
  const [job] = await query<{ current_stage: Stage }>('SELECT current_stage FROM jobs WHERE id = $1', [id])
  if (!job) throw notFound('Job')
  if (job.current_stage === 'dispatched') throw conflict('This job has been dispatched and can no longer be edited')
  if (patch.dueDate) assertDueDateNotPast(patch.dueDate)

  const columns: Record<keyof JobUpdate, string> = {
    dueDate: 'due_date',
    priority: 'priority',
    notes: 'notes',
    siteAddress: 'site_address',
  }
  const sets: string[] = []
  const params: unknown[] = [id]
  for (const [key, column] of Object.entries(columns) as [keyof JobUpdate, string][]) {
    if (patch[key] !== undefined) {
      params.push(patch[key])
      sets.push(`${column} = $${params.length}`)
    }
  }
  await query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $1`, params)
  return getJobDetail(id)
}

/** Issues a new share token, which immediately disables the old client link. */
export async function regenerateShareToken(id: number): Promise<string> {
  const token = newShareToken()
  const rows = await query('UPDATE jobs SET share_token = $2 WHERE id = $1 RETURNING id', [id, token])
  if (!rows[0]) throw notFound('Job')
  return token
}

/** What a client sees on their share link: progress only, nothing internal. */
export async function getPublicJobStatus(token: string): Promise<PublicJobStatus> {
  const [job] = await query<{
    id: number
    job_number: string
    client_name: string
    material_name: string
    due_date: string
    current_stage: Stage
    stage_updated_at: Date
    dispatched_at: Date | null
    part_count: number
  }>(
    `SELECT j.id, j.job_number, c.name AS client_name, m.name AS material_name, j.due_date, j.current_stage,
            j.stage_updated_at, j.dispatched_at,
            (SELECT COALESCE(sum(quantity), 0)::int FROM job_pieces WHERE job_id = j.id) AS part_count
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
       JOIN materials m ON m.id = j.material_id
      WHERE j.share_token = $1`,
    [token],
  )
  if (!job) throw notFound('Job')

  // When did the job most recently enter each stage? (After a remake it re-enters cutting.)
  const entered = await query<{ to_stage: Stage; at: Date }>(
    `SELECT to_stage, max(created_at) AS at FROM stage_events WHERE job_id = $1 GROUP BY to_stage`,
    [job.id],
  )
  const enteredAt = new Map(entered.map((e) => [e.to_stage, e.at.toISOString()]))
  const current = stageIndex(job.current_stage)

  return {
    jobNumber: job.job_number,
    clientName: job.client_name,
    materialName: job.material_name,
    dueDate: job.due_date,
    stage: job.current_stage,
    partCount: job.part_count,
    dispatchedAt: job.dispatched_at ? job.dispatched_at.toISOString() : null,
    lastUpdated: job.stage_updated_at.toISOString(),
    timeline: STAGES.map((stage, i) => ({
      stage,
      label: STAGE_LABELS[stage],
      reachedAt: i <= current ? (enteredAt.get(stage) ?? null) : null,
      state: i < current || job.current_stage === 'dispatched' ? 'done' : i === current ? 'current' : 'upcoming',
    })),
  }
}
