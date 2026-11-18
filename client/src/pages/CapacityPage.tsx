import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { STAGE_LABELS } from '../../../shared/stages'
import type { CapacityDay, CapacityJob, CapacityPlan, Machine } from '../../../shared/types'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { PriorityTag, StatusBadge } from '../components/Badges'
import { ErrorNotice, Loading } from '../components/Feedback'
import { PageHeader } from '../components/Layout'
import { useToast } from '../components/Toast'
import { formatDate, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const HORIZONS = [10, 15, 20] as const
const ORDER = { late: 0, at_risk: 1, on_track: 2 } as const

type Resource = 'saw' | 'cnc' | 'labour'
const RESOURCE_LABELS: Record<Resource, string> = { saw: 'Bridge saw', cnc: 'CNC and edge line', labour: 'Labour' }

function Meter({ planned, capacity }: { planned: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, (planned / capacity) * 100) : 0
  return (
    <span className={`meter ${pct >= 95 ? 'is-full' : ''}`} title={`${planned} of ${capacity} h planned`}>
      <span className="meter-track">
        <span className="meter-fill" style={{ '--w': `${pct}%` } as CSSProperties} />
      </span>
      <span className="meter-text">{planned > 0 ? `${planned}` : ''}</span>
    </span>
  )
}

function dayLabel(date: string) {
  const [weekday, day] = formatDate(date).split(' ')
  return (
    <>
      <span>{weekday}</span>
      <span>{day}</span>
    </>
  )
}

function JobCells({ job, days }: { job: CapacityJob; days: CapacityDay[] }) {
  return (
    <>
      {days.map((d) => {
        const working = job.workDays.includes(d.date)
        const due = job.dueDate === d.date
        const finish = job.projectedFinish === d.date
        return (
          <td key={d.date} className={`gantt-cell ${working ? 'is-working' : ''} ${due ? 'is-due' : ''}`}>
            {working && <span className={`gantt-bar gantt-${job.status} ${finish ? 'is-finish' : ''}`} />}
            {due && <span className="gantt-due" title={`Due ${formatDate(job.dueDate)}`} />}
          </td>
        )
      })}
    </>
  )
}

export function CapacityPage() {
  useDocumentTitle('Capacity')
  const { user } = useAuth()
  const [days, setDays] = useState<(typeof HORIZONS)[number]>(10)
  const plan = useApi<CapacityPlan>(`/capacity?days=${days}`)
  const p = plan.data

  return (
    <>
      <PageHeader title="Capacity plan" sub="Planned from standard times: earliest due date first, one stage per job per day, Monday to Friday.">
        <div className="segmented" role="radiogroup" aria-label="Planning horizon">
          {HORIZONS.map((h) => (
            <label key={h} className={days === h ? 'is-selected' : ''}>
              <input type="radio" name="horizon" checked={days === h} onChange={() => setDays(h)} />
              {h} working days
            </label>
          ))}
        </div>
      </PageHeader>

      {plan.error && <ErrorNotice error={plan.error} onRetry={plan.reload} />}
      {!p && plan.loading && <Loading />}
      {p && (
        <div className={plan.loading ? 'is-refreshing' : ''}>
          <p className="summary-line">
            <StatusBadge status="late" /> {p.summary.late}
            <StatusBadge status="at_risk" /> {p.summary.atRisk}
            <StatusBadge status="on_track" /> {p.summary.onTrack}
            <span className="muted">
              {plural(p.jobs.length, 'job')} in the factory. Saw {p.resources.sawHoursPerDay} h, CNC {p.resources.cncHoursPerDay} h and labour{' '}
              {p.resources.labourHoursPerDay} h a day ({plural(p.resources.operators, 'operator')} at 7.6 h).
            </span>
          </p>

          <section className="section" aria-labelledby="load-heading">
            <h2 id="load-heading" className="section-title">
              Hours planned per day
            </h2>
            <div className="table-wrap">
              <table className="table capacity-grid">
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    {p.days.map((d) => (
                      <th key={d.date} scope="col" className="day-head">
                        {dayLabel(d.date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(['saw', 'cnc', 'labour'] as const).map((r) => (
                    <tr key={r}>
                      <th scope="row">
                        {RESOURCE_LABELS[r]}
                        <span className="cell-sub">{p.days[0]?.[r].capacity} h a day</span>
                      </th>
                      {p.days.map((d) => (
                        <td key={d.date}>
                          <Meter planned={d[r].planned} capacity={d[r].capacity} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Due</th>
                    {p.days.map((d) => (
                      <td key={d.date} className="due-list">
                        {d.jobsDue.map((n) => (
                          <span key={n}>{n}</span>
                        ))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="section" aria-labelledby="jobs-plan-heading">
            <h2 id="jobs-plan-heading" className="section-title">
              Jobs against due dates
            </h2>
            <p className="muted legend">
              <span className="legend-item">
                <span className="gantt-bar gantt-on_track" /> Planned work
              </span>
              <span className="legend-item">
                <span className="gantt-due" /> Due date
              </span>
            </p>
            <div className="table-wrap">
              <table className="table gantt">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Due</th>
                    <th scope="col">Finishes</th>
                    <th scope="col">Status</th>
                    {p.days.map((d) => (
                      <th key={d.date} scope="col" className="day-head">
                        {dayLabel(d.date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...p.jobs]
                    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.dueDate.localeCompare(b.dueDate))
                    .map((job) => (
                      <tr key={job.id} className={`row-${job.status}`}>
                        <th scope="row">
                          <Link to={`/jobs/${job.id}`} className="job-number">
                            {job.jobNumber}
                          </Link>
                          <PriorityTag priority={job.priority} />
                          <span className="cell-sub">{job.clientName}</span>
                        </th>
                        <td>{STAGE_LABELS[job.stage]}</td>
                        <td>{formatDate(job.dueDate)}</td>
                        <td>
                          {job.projectedFinish ? formatDate(job.projectedFinish) : 'Not in plan'}
                          {job.slackDays !== null && (
                            <span className="cell-sub">
                              {job.slackDays === 0 ? 'On the due date' : job.slackDays > 0 ? `${plural(job.slackDays, 'day')} spare` : `${plural(-job.slackDays, 'day')} late`}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={job.status} />
                        </td>
                        <JobCells job={job} days={p.days} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {user?.role === 'admin' && <MachineSettings onSaved={plan.reload} />}
        </div>
      )}
    </>
  )
}

/** Admins can change machine hours (for example a second shift) and see the plan update. */
function MachineSettings({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const machines = useApi<Machine[]>('/machines')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState<ApiError | null>(null)

  async function save(machine: Machine) {
    setError(null)
    try {
      await api(`/machines/${machine.id}`, { method: 'PATCH', body: { hoursPerDay: drafts[machine.id] } })
      toast(`${machine.name} set to ${drafts[machine.id]} h a day`)
      setDrafts((d) => {
        const next = { ...d }
        delete next[machine.id]
        return next
      })
      machines.reload()
      onSaved()
    } catch (err) {
      setError(err as ApiError)
    }
  }

  if (!machines.data) return null
  return (
    <section className="section" aria-labelledby="machines-heading">
      <h2 id="machines-heading" className="section-title">
        Machine hours
      </h2>
      <p className="muted">Admins only. Change a machine's daily hours to see the effect of overtime or a breakdown.</p>
      {error && <ErrorNotice error={error} />}
      <ul className="machines">
        {machines.data.map((m) => (
          <li key={m.id}>
            <span>
              <strong>{m.name}</strong> <span className="code">{m.code}</span>
            </span>
            <label>
              <span className="visually-hidden">Hours a day for {m.name}</span>
              <input inputMode="decimal" value={drafts[m.id] ?? String(m.hoursPerDay)} onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))} />
            </label>
            <span>h a day</span>
            {drafts[m.id] !== undefined && drafts[m.id] !== String(m.hoursPerDay) && (
              <button type="button" className="button button-quiet" onClick={() => void save(m)}>
                Save
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
