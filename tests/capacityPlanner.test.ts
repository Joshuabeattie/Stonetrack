import { describe, expect, it } from 'vitest'
import type { StageWork } from '../shared/cuttingList'
import { planCapacity, type PlannerJob } from '../server/services/capacityPlanner'

const MONDAY = '2026-11-16'
const resources = { saw: 8, cnc: 8, labour: 40 }

function work(saw = 2, cnc = 2): StageWork[] {
  return [
    { stage: 'slab_allocation', saw: 0, cnc: 0, labour: 0.5 },
    { stage: 'cutting', saw, cnc: 0, labour: saw },
    { stage: 'finishing', saw: 0, cnc, labour: cnc },
    { stage: 'quality_check', saw: 0, cnc: 0, labour: 0.5 },
    { stage: 'dispatch', saw: 0, cnc: 0, labour: 1 },
  ]
}

function job(id: number, dueDate: string, overrides: Partial<PlannerJob> = {}): PlannerJob {
  return { id, jobNumber: `J-${1000 + id}`, clientName: 'Client', stage: 'slab_allocation', priority: 'normal', dueDate, work: work(), ...overrides }
}

describe('planCapacity', () => {
  it('moves a job one stage per working day', () => {
    const plan = planCapacity([job(1, '2026-11-27')], resources, MONDAY, 10)
    // Mon allocation, Tue cutting, Wed finishing, Thu QC, Fri dispatch
    expect(plan.jobs[0].workDays).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
    expect(plan.jobs[0].projectedFinish).toBe('2026-11-20')
    expect(plan.jobs[0].slackDays).toBe(5)
    expect(plan.jobs[0].status).toBe('on_track')
  })

  it('skips weekends', () => {
    const plan = planCapacity([job(1, '2026-11-30', { stage: 'quality_check', work: work().slice(3) })], resources, '2026-11-20', 5)
    expect(plan.jobs[0].workDays).toEqual(['2026-11-20', '2026-11-23']) // Fri, then Mon
  })

  it('splits a task across days when a machine is full', () => {
    const big = job(1, '2026-12-11', { stage: 'cutting', work: work(12, 1).slice(1) }) // 12 saw hours, 8 per day
    const plan = planCapacity([big], resources, MONDAY, 5)
    expect(plan.days[0].saw.planned).toBe(8)
    expect(plan.days[1].saw.planned).toBe(4)
    expect(plan.jobs[0].workDays[0]).toBe(MONDAY)
    expect(plan.jobs[0].projectedFinish).toBe('2026-11-20') // cut Mon–Tue, finish Wed, QC Thu, dispatch Fri
  })

  it('serves the earliest due date first, and urgent jobs first on the same date', () => {
    const jobs = [
      job(1, '2026-11-25', { stage: 'cutting', work: work(8).slice(1) }),
      job(2, '2026-11-20', { stage: 'cutting', work: work(8).slice(1) }),
      job(3, '2026-11-20', { stage: 'cutting', work: work(8).slice(1), priority: 'urgent' }),
    ]
    const plan = planCapacity(jobs, resources, MONDAY, 5)
    const firstSawDay = (id: number) => plan.jobs.find((j) => j.id === id)!.workDays[0]
    expect(plan.jobs.map((j) => j.id)).toEqual([3, 2, 1])
    expect(firstSawDay(3)).toBe('2026-11-16')
    expect(firstSawDay(2)).toBe('2026-11-17') // the saw was full on Monday
    expect(firstSawDay(1)).toBe('2026-11-18')
  })

  it('marks late, at-risk and overdue jobs', () => {
    const plan = planCapacity(
      [
        job(1, '2026-11-18'), // needs until Friday: late
        job(2, '2026-11-23'), // Friday finish, due Monday: 1 day spare = at risk
        job(3, '2026-11-13', { stage: 'dispatch', work: work().slice(4) }), // already overdue
      ],
      resources,
      MONDAY,
      5,
    )
    const status = Object.fromEntries(plan.jobs.map((j) => [j.id, j.status]))
    expect(status).toEqual({ 1: 'late', 2: 'at_risk', 3: 'late' })
    expect(plan.summary).toEqual({ late: 2, atRisk: 1, onTrack: 0 })
  })

  it('reports a job it can never finish (no capacity) as late with no finish date', () => {
    const plan = planCapacity([job(1, '2026-12-31')], { saw: 0, cnc: 8, labour: 40 }, MONDAY, 5)
    expect(plan.jobs[0].projectedFinish).toBeNull()
    expect(plan.jobs[0].status).toBe('late')
  })

  it('returns one row per working day in the horizon, with jobs due that day', () => {
    const plan = planCapacity([job(1, '2026-11-19')], resources, MONDAY, 10)
    expect(plan.days).toHaveLength(10)
    expect(plan.days.find((d) => d.date === '2026-11-19')!.jobsDue).toEqual(['J-1001'])
    expect(plan.days.some((d) => d.date === '2026-11-21')).toBe(false) // Saturday
  })
})
