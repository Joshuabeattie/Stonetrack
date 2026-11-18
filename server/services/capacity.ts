// Loads what the capacity planner needs from the database and runs it.
import { stageWorkFromHours } from '../../shared/cuttingList'
import { stageIndex } from '../../shared/stages'
import type { CapacityPlan } from '../../shared/types'
import { config } from '../config'
import { JOB_SUMMARY_SQL, type JobSummaryRow } from '../db/mappers'
import { query } from '../db/pool'
import { planCapacity, type PlannerJob } from './capacityPlanner'
import { factoryToday, loadJobPlans } from './jobs'
import { listMachines, listOperators } from './reference'

export async function getCapacityPlan(horizonDays: number): Promise<CapacityPlan> {
  const machines = (await listMachines()).filter((m) => m.active)
  const operators = await listOperators()
  const round1 = (n: number) => Math.round(n * 10) / 10
  const resources = {
    saw: round1(machines.filter((m) => m.workCentre === 'saw').reduce((sum, m) => sum + m.hoursPerDay, 0)),
    cnc: round1(machines.filter((m) => m.workCentre === 'cnc').reduce((sum, m) => sum + m.hoursPerDay, 0)),
    // Labour capacity = active operators × a standard 7.6-hour day.
    labour: round1(operators.length * config.standardShiftHours),
  }

  const rows = await query<JobSummaryRow>(`${JOB_SUMMARY_SQL} WHERE j.current_stage <> 'dispatched'`)
  const plans = await loadJobPlans(rows.map((r) => r.id))
  const jobs: PlannerJob[] = rows.map((row) => {
    const plan = plans.get(row.id)
    const allWork = plan ? stageWorkFromHours(plan.cuttingList.hours) : []
    return {
      id: row.id,
      jobNumber: row.job_number,
      clientName: row.client_name,
      stage: row.current_stage,
      priority: row.priority,
      dueDate: row.due_date,
      // The current stage counts as not started (we don't track part-done stages).
      work: allWork.filter((w) => stageIndex(w.stage) >= stageIndex(row.current_stage)),
    }
  })

  const today = factoryToday()
  return {
    today,
    resources: { sawHoursPerDay: resources.saw, cncHoursPerDay: resources.cnc, labourHoursPerDay: resources.labour, operators: operators.length },
    ...planCapacity(jobs, resources, today, horizonDays),
  }
}
