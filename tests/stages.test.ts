import { beforeEach, describe, expect, it } from 'vitest'
import { getPool } from '../server/db/pool'
import { advance, api, bearer, createJob, resetDatabase, tokenFor, validJob } from './helpers'

let manager: string
let kiosk: string

beforeEach(async () => {
  await resetDatabase()
  manager = await tokenFor('manager')
  kiosk = await tokenFor('kiosk')
})

const getJob = async (id: number) => (await api().get(`/api/jobs/${id}`).set(bearer(manager))).body

describe('POST /api/jobs/:id/advance', () => {
  it('allocates slabs automatically when leaving slab allocation, and books standard hours by default', async () => {
    const id = await createJob(manager)
    const res = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation', operatorId: 1 })
    expect(res.status).toBe(200)
    expect(res.body.job.stage).toBe('cutting')
    expect(res.body.allocatedSlabs).toEqual(['SL-0001']) // oldest stock first
    expect(res.body.event).toMatchObject({ eventType: 'advanced', fromStage: 'slab_allocation', toStage: 'cutting', operatorName: 'Sam Saw', userName: 'Test Kiosk' })

    const job = await getJob(id)
    expect(res.body.event.labourHours).toBe(job.cuttingList.hours.labour.slab_allocation)
    expect(job.slabs.map((s: { code: string; status: string }) => [s.code, s.status])).toEqual([['SL-0001', 'allocated']])
  })

  it('moves a job through every stage to dispatched, consuming its slabs after cutting', async () => {
    const id = await createJob(manager)
    await advance(kiosk, id, 2) // → cutting → finishing
    expect((await getJob(id)).slabs[0].status).toBe('consumed')
    await advance(kiosk, id, 3) // → quality check → dispatch → dispatched
    const job = await getJob(id)
    expect(job.stage).toBe('dispatched')
    expect(job.dispatchedAt).not.toBeNull()
    expect(job.events.map((e: { toStage: string }) => e.toStage)).toEqual([
      'slab_allocation',
      'cutting',
      'finishing',
      'quality_check',
      'dispatch',
      'dispatched',
    ])

    const again = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'dispatched' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_DISPATCHED')
  })

  it('refuses with 409 when the job has moved on since the caller looked', async () => {
    const id = await createJob(manager)
    const res = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'cutting' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('STAGE_CHANGED')
    expect((await getJob(id)).stage).toBe('slab_allocation')
  })

  it('lets only one of two simultaneous taps through', async () => {
    const id = await createJob(manager)
    const tap = () => api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation' })
    const results = await Promise.all([tap(), tap()])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const job = await getJob(id)
    expect(job.stage).toBe('cutting')
    expect(job.slabs).toHaveLength(1)
    expect(job.events).toHaveLength(2)
  })

  it('fails with INSUFFICIENT_STOCK and changes nothing when the yard is short', async () => {
    // Two marble pieces too big to share one slab, but only one marble slab in stock.
    const piece = { name: 'Wide piece', lengthMm: 2600, widthMm: 1000, quantity: 2, edgeProfile: 'arris' as const, polishedEdges: [], cutouts: 0 }
    const id = await createJob(manager, { materialId: 2, pieces: [piece] })
    const res = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(res.body.error.message).toContain('needs 2 more Test Marble slabs')

    const job = await getJob(id)
    expect(job.stage).toBe('slab_allocation')
    expect(job.slabs).toHaveLength(0) // the transaction rolled back
    expect(job.events).toHaveLength(1)
  })

  it('rejects an unknown operator and out-of-range hours', async () => {
    const id = await createJob(manager)
    const badOperator = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation', operatorId: 99 })
    expect(badOperator.status).toBe(422)
    const badHours = await api().post(`/api/jobs/${id}/advance`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation', labourHours: -1 })
    expect(badHours.status).toBe(422)
  })
})

describe('POST /api/jobs/:id/remake', () => {
  it('sends the job back to cutting and records the reason and piece', async () => {
    const id = await createJob(manager)
    await advance(kiosk, id, 2) // in finishing
    const pieceId = (await getJob(id)).pieces[0].id
    const res = await api()
      .post(`/api/jobs/${id}/remake`)
      .set(bearer(kiosk))
      .send({ expectedStage: 'finishing', reason: 'chipped_edge', pieceId, operatorId: 1, note: 'Chip on front edge' })
    expect(res.status).toBe(200)
    expect(res.body.stage).toBe('cutting')
    expect(res.body.event).toMatchObject({ eventType: 'remake', fromStage: 'finishing', toStage: 'cutting', remakeReason: 'chipped_edge', pieceName: 'Bench' })

    const job = await getJob(id)
    expect(job.stage).toBe('cutting')
    expect(job.remakeCount).toBe(1)
  })

  it('is not allowed before cutting has started', async () => {
    const id = await createJob(manager)
    const res = await api().post(`/api/jobs/${id}/remake`).set(bearer(kiosk)).send({ expectedStage: 'slab_allocation', reason: 'cracked_piece' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REMAKE_NOT_ALLOWED')
  })

  it('validates the reason and the piece', async () => {
    const id = await createJob(manager)
    const other = await createJob(manager, { clientName: 'Other' })
    await advance(kiosk, id, 1)
    const otherPiece = (await getJob(other)).pieces[0].id
    const badReason = await api().post(`/api/jobs/${id}/remake`).set(bearer(kiosk)).send({ expectedStage: 'cutting', reason: 'bad_vibes' })
    expect(badReason.status).toBe(422)
    const wrongPiece = await api().post(`/api/jobs/${id}/remake`).set(bearer(kiosk)).send({ expectedStage: 'cutting', reason: 'cracked_piece', pieceId: otherPiece })
    expect(wrongPiece.status).toBe(422)
    expect(wrongPiece.body.error.details[0].path).toBe('pieceId')
  })
})

describe('GET /api/kiosk/jobs', () => {
  it('lists jobs still in the factory with the defaults the kiosk needs', async () => {
    const id = await createJob(manager)
    const done = await createJob(manager, { clientName: 'Done Already' })
    await advance(kiosk, done, 5)

    const res = await api().get('/api/kiosk/jobs').set(bearer(kiosk))
    expect(res.status).toBe(200)
    expect(res.body.map((j: { id: number }) => j.id)).toEqual([id])
    expect(res.body[0]).toMatchObject({ stage: 'slab_allocation', slabsAllocated: 0, slabsRequired: 1, partCount: 1 })
    expect(res.body[0].standardHours).toBeGreaterThan(0)
    expect(res.body[0].pieces[0]).toMatchObject({ name: 'Bench', lengthMm: 2400, widthMm: 650 })
  })
})

describe('history integrity', () => {
  it('keeps the job stage equal to the last history event', async () => {
    const id = await createJob(manager)
    await advance(kiosk, id, 3)
    await api().post(`/api/jobs/${id}/remake`).set(bearer(kiosk)).send({ expectedStage: 'quality_check', reason: 'polish_defect' })
    const { rows } = await getPool().query(
      `SELECT j.current_stage, (SELECT to_stage FROM stage_events WHERE job_id = j.id ORDER BY id DESC LIMIT 1) AS last
         FROM jobs j WHERE j.id = $1`,
      [id],
    )
    expect(rows[0].current_stage).toBe(rows[0].last)
  })

  it('writes nothing when a job is rejected inside the intake transaction', async () => {
    // The oversize check runs inside the transaction; the client must not be left behind.
    const res = await api()
      .post('/api/jobs')
      .set(bearer(manager))
      .send(validJob({ clientName: 'Ghost Client', pieces: [{ ...validJob().pieces[0], lengthMm: 3900 }] }))
    expect(res.status).toBe(422)
    const { rows } = await getPool().query('SELECT (SELECT count(*) FROM jobs)::int AS jobs, (SELECT count(*) FROM clients)::int AS clients')
    expect(rows[0]).toEqual({ jobs: 0, clients: 0 })
  })
})
