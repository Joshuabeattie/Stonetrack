import { beforeEach, describe, expect, it } from 'vitest'
import { getPool } from '../server/db/pool'
import { advance, api, bearer, createJob, resetDatabase, today, tokenFor, workingDaysFromToday } from './helpers'

let manager: string

beforeEach(async () => {
  await resetDatabase()
  manager = await tokenFor('manager')
})

describe('GET /api/capacity', () => {
  it('plans machine and labour hours from machines and operators', async () => {
    await createJob(manager)
    const res = await api().get('/api/capacity?days=5').set(bearer(manager))
    expect(res.status).toBe(200)
    expect(res.body.resources).toEqual({ sawHoursPerDay: 7.6, cncHoursPerDay: 7.6, labourHoursPerDay: 15.2, operators: 2 })
    expect(res.body.days).toHaveLength(5)
    expect(res.body.jobs[0]).toMatchObject({ jobNumber: 'J-1001', status: 'on_track' })
  })

  it('flags a job that cannot make its due date', async () => {
    const id = await createJob(manager)
    // Pretend the job was promised for tomorrow: it still needs five stages.
    await getPool().query('UPDATE jobs SET due_date = $2 WHERE id = $1', [id, workingDaysFromToday(1)])
    const res = await api().get('/api/capacity').set(bearer(manager))
    expect(res.body.jobs[0].status).toBe('late')
    expect(res.body.summary.late).toBe(1)
  })

  it('leaves dispatched jobs out of the plan', async () => {
    const id = await createJob(manager)
    await advance(manager, id, 5)
    const res = await api().get('/api/capacity').set(bearer(manager))
    expect(res.body.jobs).toHaveLength(0)
  })

  it('validates the horizon', async () => {
    expect((await api().get('/api/capacity?days=500').set(bearer(manager))).status).toBe(422)
  })
})

describe('GET /api/kpis', () => {
  it('calculates throughput, lead time, remake rate, waste and labour from the data', async () => {
    // Job 1: straight through. Job 2: one remake. Job 3: still in the factory.
    const first = await createJob(manager)
    await advance(manager, first, 5)

    const second = await createJob(manager, { clientName: 'Remake Homes' })
    await advance(manager, second, 2)
    await api().post(`/api/jobs/${second}/remake`).set(bearer(manager)).send({ expectedStage: 'finishing', reason: 'chipped_edge' })
    await advance(manager, second, 4)

    await createJob(manager, { clientName: 'Still Here' })

    const res = await api().get('/api/kpis?days=30').set(bearer(manager))
    expect(res.status).toBe(200)
    const k = res.body
    expect(k.throughput.jobs).toBe(2)
    expect(k.throughput.areaM2).toBeCloseTo(2 * 1.56)
    expect(k.throughput.weekly).toHaveLength(8)
    expect(k.throughput.weekly[7].jobs).toBe(2) // this week
    expect(k.leadTime.averageDays).toBeGreaterThanOrEqual(0)
    expect(k.onTime).toEqual({ pct: 100, late: 0 })
    expect(k.remakes).toMatchObject({ ratePct: 50, jobsWithRemakes: 1, events: 1, byReason: [{ reason: 'chipped_edge', count: 1 }] })
    // Each job used one 3000 × 1800 slab (5.4 m²) for a 1.56 m² bench.
    expect(k.waste).toMatchObject({ slabAreaM2: 10.8, pieceAreaM2: 3.12, offcutAreaM2: 7.68 })
    expect(k.waste.pct).toBeCloseTo((1 - 3.12 / 10.8) * 100, 1)
    // 1 hour booked per completed stage. Job 1: 5. Job 2: 2 before the remake + 4 after = 6. Total 11.
    expect(k.labour.hours).toBe(11)
    expect(k.labour.m2PerHour).toBeCloseTo(3.12 / 11, 2)
    expect(k.wip.find((w: { stage: string }) => w.stage === 'slab_allocation').jobs).toBe(1)
  })

  it('counts a job dispatched after its due date as late', async () => {
    const id = await createJob(manager)
    await advance(manager, id, 5)
    await getPool().query(`UPDATE jobs SET due_date = $2 WHERE id = $1`, [id, workingDaysFromToday(-2)])
    const res = await api().get('/api/kpis').set(bearer(manager))
    expect(res.body.onTime).toEqual({ pct: 0, late: 1 })
  })

  it('returns empty values rather than dividing by zero when nothing was dispatched', async () => {
    const res = await api().get('/api/kpis?days=7').set(bearer(manager))
    expect(res.body.throughput.jobs).toBe(0)
    expect(res.body.leadTime.averageDays).toBeNull()
    expect(res.body.remakes.ratePct).toBeNull()
    expect(res.body.waste.pct).toBeNull()
    expect(res.body.labour.m2PerHour).toBeNull()
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
