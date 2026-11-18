// KPIs, all calculated from the data (nothing is entered by hand):
//
//  Throughput        jobs (and m²) dispatched in the period, plus the last 8 weeks week by week
//  Lead time         dispatched_at − created_at for those jobs (average and median, in days)
//  On time           share of those jobs dispatched on or before their due date
//  Remake rate       share of those jobs that needed at least one remake; remakes by reason
//  Waste             1 − (piece area ÷ area of the slabs the jobs used)
//  Labour            m² per labour hour booked at the kiosk; efficiency = standard ÷ actual hours
//  WIP               jobs in each stage right now
import { addDays, todayInZone, type IsoDate } from '../../shared/dates'
import type { RemakeReason } from '../../shared/catalog'
import { WORK_STAGES, type Stage } from '../../shared/stages'
import type { KpiReport } from '../../shared/types'
import { config } from '../config'
import { query } from '../db/pool'
import { loadJobPlans } from './jobs'

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null)

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Monday of the week containing `date`. */
function weekStart(date: IsoDate): IsoDate {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(date, -((day + 6) % 7))
}

export async function getKpis(periodDays: number): Promise<KpiReport> {
  const tz = config.factoryTimezone
  const to = new Date()
  const from = new Date(to.getTime() - periodDays * 86_400_000)

  // One row per job dispatched in the period, with its areas, labour and remakes.
  const jobs = await query<{
    id: number
    created_at: Date
    dispatched_at: Date
    due_date: string
    dispatched_date: string
    area_m2: number
    slab_area_m2: number
    labour_hours: number
    remakes: number
  }>(
    `SELECT j.id, j.created_at, j.dispatched_at, j.due_date,
            (j.dispatched_at AT TIME ZONE $2)::date AS dispatched_date,
            COALESCE((SELECT sum(length_mm::numeric * width_mm * quantity) / 1000000 FROM job_pieces WHERE job_id = j.id), 0) AS area_m2,
            COALESCE((SELECT sum(length_mm::numeric * width_mm) / 1000000 FROM slabs WHERE job_id = j.id), 0) AS slab_area_m2,
            COALESCE((SELECT sum(labour_hours) FROM stage_events WHERE job_id = j.id), 0) AS labour_hours,
            (SELECT count(*)::int FROM stage_events WHERE job_id = j.id AND event_type = 'remake') AS remakes
       FROM jobs j
      WHERE j.dispatched_at >= $1`,
    [from, tz],
  )

  const areaM2 = jobs.reduce((sum, j) => sum + j.area_m2, 0)
  const slabAreaM2 = jobs.reduce((sum, j) => sum + j.slab_area_m2, 0)
  const labourHours = jobs.reduce((sum, j) => sum + j.labour_hours, 0)
  const leadDays = jobs.map((j) => (j.dispatched_at.getTime() - j.created_at.getTime()) / 86_400_000)
  const late = jobs.filter((j) => j.dispatched_date > j.due_date).length
  const jobsWithRemakes = jobs.filter((j) => j.remakes > 0).length

  // Standard hours for the same jobs, to compare with the hours actually booked.
  const plans = await loadJobPlans(jobs.map((j) => j.id))
  const standardHours = [...plans.values()].reduce((sum, p) => sum + p.cuttingList.hours.labourTotal, 0)

  const byReason = await query<{ remake_reason: RemakeReason; count: number }>(
    `SELECT remake_reason, count(*)::int AS count
       FROM stage_events
      WHERE event_type = 'remake' AND created_at >= $1
      GROUP BY remake_reason
      ORDER BY count DESC, remake_reason`,
    [from],
  )
  const remakeEvents = byReason.reduce((sum, r) => sum + r.count, 0)

  // The last 8 weeks (Monday to Sunday, factory time), including weeks with nothing dispatched.
  const thisWeek = weekStart(todayInZone(tz))
  const firstWeek = addDays(thisWeek, -7 * 7)
  const weeklyRows = await query<{ week_start: string; jobs: number; area_m2: number }>(
    `SELECT date_trunc('week', j.dispatched_at AT TIME ZONE $1)::date AS week_start,
            count(*)::int AS jobs,
            COALESCE(sum(p.area), 0) AS area_m2
       FROM jobs j
       LEFT JOIN LATERAL (
         SELECT sum(length_mm::numeric * width_mm * quantity) / 1000000 AS area FROM job_pieces WHERE job_id = j.id
       ) p ON true
      WHERE j.dispatched_at IS NOT NULL AND (j.dispatched_at AT TIME ZONE $1)::date >= $2::date
      GROUP BY 1
      ORDER BY 1`,
    [tz, firstWeek],
  )
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(firstWeek, i * 7)
    const row = weeklyRows.find((r) => r.week_start === start)
    return { weekStart: start, jobs: row?.jobs ?? 0, areaM2: round2(row?.area_m2 ?? 0) }
  })

  const wipRows = await query<{ current_stage: Stage; jobs: number }>(
    `SELECT current_stage, count(*)::int AS jobs FROM jobs WHERE current_stage <> 'dispatched' GROUP BY current_stage`,
  )

  return {
    periodDays,
    from: from.toISOString(),
    to: to.toISOString(),
    throughput: { jobs: jobs.length, areaM2: round2(areaM2), weekly },
    leadTime: {
      averageDays: leadDays.length ? round1(leadDays.reduce((a, b) => a + b, 0) / leadDays.length) : null,
      medianDays: leadDays.length ? round1(median(leadDays)!) : null,
    },
    onTime: { pct: pct(jobs.length - late, jobs.length), late },
    remakes: {
      ratePct: pct(jobsWithRemakes, jobs.length),
      jobsWithRemakes,
      events: remakeEvents,
      byReason: byReason.map((r) => ({ reason: r.remake_reason, count: r.count })),
    },
    waste: {
      pct: slabAreaM2 > 0 ? round1((1 - areaM2 / slabAreaM2) * 100) : null,
      slabAreaM2: round2(slabAreaM2),
      pieceAreaM2: round2(areaM2),
      offcutAreaM2: round2(slabAreaM2 - areaM2),
    },
    labour: {
      hours: round1(labourHours),
      m2PerHour: labourHours > 0 ? round2(areaM2 / labourHours) : null,
      standardHours: round1(standardHours),
      efficiencyPct: labourHours > 0 ? round1((standardHours / labourHours) * 100) : null,
    },
    wip: WORK_STAGES.map((stage) => ({ stage, jobs: wipRows.find((r) => r.current_stage === stage)?.jobs ?? 0 })),
  }
}
