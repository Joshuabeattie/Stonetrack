// Moving jobs through the factory: completing a stage, flagging a remake, and the
// list of jobs the kiosk shows. Every change writes a row to stage_events, which is
// the job's timestamped history.
import type pg from 'pg'
import type { AdvanceStageInput, RemakeInput } from '../../shared/schemas'
import {
  REMAKE_RETURN_STAGE,
  STAGE_LABELS,
  canFlagRemake,
  nextStage,
  type Stage,
  type WorkStage,
} from '../../shared/stages'
import type { AdvanceResult, AuthUser, KioskJob, StageEvent } from '../../shared/types'
import { JOB_SUMMARY_SQL, STAGE_EVENT_SQL, toJobSummary, toStageEvent, type JobSummaryRow, type StageEventRow } from '../db/mappers'
import { query, withTransaction } from '../db/pool'
import { conflict, notFound, validationError } from '../http/errors'
import { loadJobPlans } from './jobs'
import { isActiveOperator } from './reference'
import { allocateShortfall } from './slabs'

interface LockedJob {
  id: number
  job_number: string
  current_stage: Stage
  material_id: number
  material_name: string
}

/**
 * Locks the job row until the transaction ends (SELECT … FOR UPDATE), so two kiosks
 * tapping the same job at the same moment are handled one after the other.
 */
async function lockJob(tx: pg.PoolClient, jobId: number): Promise<LockedJob> {
  const [job] = await query<LockedJob>(
    `SELECT j.id, j.job_number, j.current_stage, j.material_id, m.name AS material_name
       FROM jobs j JOIN materials m ON m.id = j.material_id
      WHERE j.id = $1
      FOR UPDATE OF j`,
    [jobId],
    tx,
  )
  if (!job) throw notFound('Job')
  return job
}

function assertExpectedStage(job: LockedJob, expected: Stage) {
  if (job.current_stage !== expected) {
    throw conflict(
      `${job.job_number} is now in ${STAGE_LABELS[job.current_stage]}, not ${STAGE_LABELS[expected]}. Someone else has updated it — refresh and try again.`,
      'STAGE_CHANGED',
    )
  }
}

async function assertOperator(tx: pg.PoolClient, operatorId: number | undefined) {
  if (operatorId !== undefined && !(await isActiveOperator(operatorId, tx))) {
    throw validationError([{ path: 'operatorId', message: 'Unknown operator' }])
  }
}

async function loadEvent(tx: pg.PoolClient, eventId: number): Promise<StageEvent> {
  const [row] = await query<StageEventRow>(`${STAGE_EVENT_SQL} WHERE e.id = $1`, [eventId], tx)
  return toStageEvent(row)
}

/** Completes the job's current stage and moves it to the next one. */
export async function advanceJob(jobId: number, input: AdvanceStageInput, user: AuthUser): Promise<AdvanceResult> {
  return withTransaction(async (tx) => {
    const job = await lockJob(tx, jobId)
    assertExpectedStage(job, input.expectedStage)
    const to = nextStage(job.current_stage)
    if (!to) throw conflict(`${job.job_number} has already been dispatched`, 'ALREADY_DISPATCHED')
    await assertOperator(tx, input.operatorId)

    const from = job.current_stage as WorkStage
    const plan = (await loadJobPlans([jobId], tx)).get(jobId)
    if (!plan) throw notFound('Job plan')
    // If the worker didn't enter hours, book the standard time for the stage.
    const labourHours = input.labourHours ?? plan.cuttingList.hours.labour[from]

    let allocatedSlabs: string[] = []
    if (from === 'slab_allocation') {
      // Can't start cutting without stone: top up to what the cutting list needs (or fail with 409).
      allocatedSlabs = await allocateShortfall(tx, job, plan.cuttingList.totals.slabsRequired)
    }
    if (from === 'cutting') {
      // Cutting is done, so the job's slabs have been used up.
      await query(`UPDATE slabs SET status = 'consumed', consumed_at = now() WHERE job_id = $1 AND status = 'allocated'`, [jobId], tx)
    }

    await query(
      `UPDATE jobs
          SET current_stage = $2,
              stage_updated_at = now(),
              dispatched_at = CASE WHEN $2::text = 'dispatched' THEN now() END
        WHERE id = $1`,
      [jobId, to],
      tx,
    )
    const [inserted] = await query<{ id: number }>(
      `INSERT INTO stage_events (job_id, event_type, from_stage, to_stage, labour_hours, operator_id, user_id, note)
       VALUES ($1, 'advanced', $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [jobId, from, to, labourHours, input.operatorId ?? null, user.id, input.note ?? null],
      tx,
    )
    return {
      job: { id: job.id, jobNumber: job.job_number, stage: to },
      event: await loadEvent(tx, inserted.id),
      allocatedSlabs,
    }
  })
}

/**
 * Flags a remake: a piece is damaged or wrong and has to be cut again.
 * The job goes back to Cutting and the reason is recorded for the remake KPIs.
 */
export async function flagRemake(jobId: number, input: RemakeInput, user: AuthUser): Promise<{ event: StageEvent; stage: Stage }> {
  return withTransaction(async (tx) => {
    const job = await lockJob(tx, jobId)
    assertExpectedStage(job, input.expectedStage)
    if (!canFlagRemake(job.current_stage)) {
      throw conflict('A remake can only be flagged after cutting has started and before the job is dispatched', 'REMAKE_NOT_ALLOWED')
    }
    await assertOperator(tx, input.operatorId)
    if (input.pieceId !== undefined) {
      const pieces = await query('SELECT 1 FROM job_pieces WHERE id = $1 AND job_id = $2', [input.pieceId, jobId], tx)
      if (pieces.length === 0) throw validationError([{ path: 'pieceId', message: 'That piece is not part of this job' }])
    }

    await query('UPDATE jobs SET current_stage = $2, stage_updated_at = now() WHERE id = $1', [jobId, REMAKE_RETURN_STAGE], tx)
    const [inserted] = await query<{ id: number }>(
      `INSERT INTO stage_events (job_id, event_type, from_stage, to_stage, remake_reason, piece_id, operator_id, user_id, note)
       VALUES ($1, 'remake', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [jobId, job.current_stage, REMAKE_RETURN_STAGE, input.reason, input.pieceId ?? null, input.operatorId ?? null, user.id, input.note ?? null],
      tx,
    )
    return { event: await loadEvent(tx, inserted.id), stage: REMAKE_RETURN_STAGE }
  })
}

/** Every job still in the factory, with what the kiosk needs to show and to default. */
export async function listKioskJobs(): Promise<KioskJob[]> {
  const rows = await query<JobSummaryRow>(
    `${JOB_SUMMARY_SQL} WHERE j.current_stage <> 'dispatched' ORDER BY j.due_date, (j.priority = 'urgent') DESC, j.id`,
  )
  const ids = rows.map((r) => r.id)
  const plans = await loadJobPlans(ids)
  const slabCounts = await query<{ job_id: number; n: number }>(
    'SELECT job_id, count(*)::int AS n FROM slabs WHERE job_id = ANY($1::int[]) GROUP BY job_id',
    [ids],
  )
  const slabsByJob = new Map(slabCounts.map((s) => [s.job_id, s.n]))

  return rows.map((row) => {
    const summary = toJobSummary(row)
    const plan = plans.get(row.id)
    const stage = summary.stage as WorkStage
    return {
      id: summary.id,
      jobNumber: summary.jobNumber,
      clientName: summary.clientName,
      materialName: summary.materialName,
      swatchHex: summary.swatchHex,
      dueDate: summary.dueDate,
      priority: summary.priority,
      stage: summary.stage,
      stageUpdatedAt: summary.stageUpdatedAt,
      partCount: summary.partCount,
      pieces: (plan?.pieces ?? []).map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, lengthMm: p.lengthMm, widthMm: p.widthMm })),
      standardHours: plan?.cuttingList.hours.labour[stage] ?? 0,
      slabsAllocated: slabsByJob.get(row.id) ?? 0,
      slabsRequired: plan?.cuttingList.totals.slabsRequired ?? 0,
    }
  })
}
