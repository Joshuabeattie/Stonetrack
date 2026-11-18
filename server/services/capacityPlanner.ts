// The capacity planner: a pure function, so it can be unit-tested without a database.
//
// How it works ("finite-capacity forward scheduling, earliest due date first"):
//  1. Each job still in the factory has a list of remaining stage tasks, each needing
//     some saw hours, CNC hours and labour hours (from the cutting list's standard times).
//  2. Starting today, for each working day, give every resource its daily hours.
//  3. Go through jobs in due-date order (urgent first on the same date). Each job works
//     on its next task until it finishes or a resource it needs runs out for the day.
//     A task can be split across days. A job moves at most one stage per day: stone is
//     moved, sealed and checked between stages, so the next stage starts the next day.
//  4. The day a job's last task (Dispatch) finishes is its projected finish date.
//  5. Projected finish after the due date (or already overdue) = late;
//     finishing with one working day or less to spare = at risk.
import { addWorkingDays, onOrAfterWorkingDay, workingDaysBetween, type IsoDate } from '../../shared/dates'
import type { Priority } from '../../shared/catalog'
import type { StageWork } from '../../shared/cuttingList'
import type { Stage } from '../../shared/stages'
import type { CapacityDay, CapacityJob, CapacityStatus } from '../../shared/types'

export interface PlannerJob {
  id: number
  jobNumber: string
  clientName: string
  stage: Stage
  priority: Priority
  dueDate: IsoDate
  work: StageWork[] // remaining stage tasks, in order
}

export interface PlannerResources {
  saw: number // machine hours per working day
  cnc: number
  labour: number
}

const RESOURCES = ['saw', 'cnc', 'labour'] as const
const MAX_DAYS = 120 // stop planning after ~6 months: anything later is "late" anyway
const EPS = 1e-6
const round1 = (n: number) => Math.round(n * 10) / 10

export function planCapacity(
  jobs: PlannerJob[],
  resources: PlannerResources,
  today: IsoDate,
  horizonDays: number,
): { days: CapacityDay[]; jobs: CapacityJob[]; summary: { late: number; atRisk: number; onTrack: number } } {
  const ordered = [...jobs].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
      a.id - b.id,
  )
  const states = ordered.map((job) => ({
    job,
    tasks: job.work.map((w) => ({ ...w })), // copies, because we count them down
    finish: null as IsoDate | null,
    workDays: [] as IsoDate[],
  }))

  const days: CapacityDay[] = []
  let date = onOrAfterWorkingDay(today)
  for (let d = 0; d < MAX_DAYS && (d < horizonDays || states.some((s) => s.tasks.length > 0)); d++) {
    const left = { ...resources }
    for (const state of states) {
      let worked = false
      while (state.tasks.length > 0) {
        const task = state.tasks[0]
        // How much of this task fits in what's left today? (1 = all of it)
        let fraction = 1
        for (const r of RESOURCES) if (task[r] > EPS) fraction = Math.min(fraction, left[r] / task[r])
        if (fraction <= EPS) break
        for (const r of RESOURCES) {
          const used = task[r] * fraction
          left[r] -= used
          task[r] -= used
        }
        worked = true
        if (fraction < 1 - EPS) break // ran out of a resource: continue tomorrow
        state.tasks.shift()
        if (state.tasks.length === 0) state.finish = date
        break // one stage per job per day: the next stage starts tomorrow
      }
      if (worked) state.workDays.push(date)
    }
    if (d < horizonDays) {
      days.push({
        date,
        saw: { planned: round1(resources.saw - left.saw), capacity: resources.saw },
        cnc: { planned: round1(resources.cnc - left.cnc), capacity: resources.cnc },
        labour: { planned: round1(resources.labour - left.labour), capacity: resources.labour },
        jobsDue: ordered.filter((j) => j.dueDate === date).map((j) => j.jobNumber),
      })
    }
    date = addWorkingDays(date, 1)
  }

  const result: CapacityJob[] = states.map(({ job, finish, workDays }) => {
    const slackDays = finish ? workingDaysBetween(finish, job.dueDate) : null
    let status: CapacityStatus = 'on_track'
    if (finish === null || slackDays! < 0 || job.dueDate < today) status = 'late'
    else if (slackDays! <= 1) status = 'at_risk'
    const total = (r: (typeof RESOURCES)[number]) => round1(job.work.reduce((sum, w) => sum + w[r], 0))
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      stage: job.stage,
      priority: job.priority,
      dueDate: job.dueDate,
      projectedFinish: finish,
      slackDays,
      status,
      remaining: { saw: total('saw'), cnc: total('cnc'), labour: total('labour') },
      workDays,
    }
  })

  return {
    days,
    jobs: result,
    summary: {
      late: result.filter((j) => j.status === 'late').length,
      atRisk: result.filter((j) => j.status === 'at_risk').length,
      onTrack: result.filter((j) => j.status === 'on_track').length,
    },
  }
}
