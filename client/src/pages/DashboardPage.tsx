import { useState } from 'react'
import { Link } from 'react-router'
import { REMAKE_REASON_LABELS } from '../../../shared/catalog'
import { STAGE_LABELS } from '../../../shared/stages'
import type { CapacityPlan, KpiReport } from '../../../shared/types'
import { BarList, ColumnChart } from '../components/Charts'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { fmtM2, formatDate, formatDayMonth, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const PERIODS = [7, 30, 90] as const

function Figure({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail: string }) {
  return (
    <div className="figure">
      <p className="figure-label">{label}</p>
      <p className="figure-value">
        {value}
        {unit && <span className="figure-unit">{unit}</span>}
      </p>
      <p className="figure-detail">{detail}</p>
    </div>
  )
}

const one = (n: number | null) => (n === null ? 'n/a' : n.toFixed(1))
const whole = (n: number | null) => (n === null ? 'n/a' : Math.round(n).toString())

export function DashboardPage() {
  useDocumentTitle('Dashboard')
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const kpis = useApi<KpiReport>(`/kpis?days=${days}`)
  const plan = useApi<CapacityPlan>('/capacity?days=5')
  const k = kpis.data

  return (
    <>
      <PageHeader title="Dashboard" sub="Factory performance, calculated from every job's history.">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((p) => (
            <label key={p} className={days === p ? 'is-selected' : ''}>
              <input type="radio" name="period" value={p} checked={days === p} onChange={() => setDays(p)} />
              Last {p} days
            </label>
          ))}
        </div>
      </PageHeader>

      {plan.data && plan.data.summary.late + plan.data.summary.atRisk > 0 && (
        <p className="attention">
          <Icon name="warning" />
          <span>
            {plan.data.summary.late > 0 && `${plural(plan.data.summary.late, 'job')} will miss ${plan.data.summary.late === 1 ? 'its' : 'their'} due date`}
            {plan.data.summary.late > 0 && plan.data.summary.atRisk > 0 && ' and '}
            {plan.data.summary.atRisk > 0 && `${plural(plan.data.summary.atRisk, 'job')} ${plan.data.summary.atRisk === 1 ? 'is' : 'are'} at risk`}
            {' on the current plan.'}
          </span>
          <Link to="/capacity">Open the capacity plan</Link>
        </p>
      )}

      {k && (
        <section className="section" aria-labelledby="floor-heading">
          <h2 id="floor-heading" className="section-title">
            On the floor now
          </h2>
          <ol className="line">
            {k.wip.map((w) => (
              <li key={w.stage} className="line-station">
                <Link to={`/jobs?stage=${w.stage}`} className="line-link">
                  <span className="line-count">{w.jobs}</span>
                  <span className="line-name">{STAGE_LABELS[w.stage]}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {kpis.error && <ErrorNotice error={kpis.error} onRetry={kpis.reload} />}
      {!k && kpis.loading && <Loading />}

      {k && (
        <div className={kpis.loading ? 'is-refreshing' : ''}>
          <section className="section" aria-labelledby="kpi-heading">
            <h2 id="kpi-heading" className="section-title">
              Last {k.periodDays} days
            </h2>
            <div className="figures">
              <Figure label="Jobs dispatched" value={String(k.throughput.jobs)} detail={`${fmtM2(k.throughput.areaM2)} of benchtop`} />
              <Figure
                label="Average lead time"
                value={one(k.leadTime.averageDays)}
                unit=" days"
                detail={k.leadTime.medianDays === null ? 'From order to dispatch' : `From order to dispatch. Median ${one(k.leadTime.medianDays)} days.`}
              />
              <Figure
                label="Dispatched on time"
                value={whole(k.onTime.pct)}
                unit={k.onTime.pct === null ? undefined : '%'}
                detail={k.throughput.jobs === 0 ? 'Nothing dispatched yet' : `${plural(k.onTime.late, 'job')} late out of ${k.throughput.jobs}`}
              />
              <Figure
                label="Remake rate"
                value={whole(k.remakes.ratePct)}
                unit={k.remakes.ratePct === null ? undefined : '%'}
                detail={`${plural(k.remakes.jobsWithRemakes, 'job')} needed a remake`}
              />
              <Figure
                label="Slab waste"
                value={whole(k.waste.pct)}
                unit={k.waste.pct === null ? undefined : '%'}
                detail={`${fmtM2(k.waste.pieceAreaM2)} of benchtop from ${fmtM2(k.waste.slabAreaM2)} of slab. Offcuts count as waste.`}
              />
              <Figure
                label="Labour productivity"
                value={k.labour.m2PerHour === null ? 'n/a' : k.labour.m2PerHour.toFixed(2)}
                unit={k.labour.m2PerHour === null ? undefined : ' m² per hour'}
                detail={
                  k.labour.efficiencyPct === null
                    ? 'No labour booked yet'
                    : `${k.labour.hours} h booked against ${k.labour.standardHours} h standard (${whole(k.labour.efficiencyPct)}% efficiency)`
                }
              />
            </div>
          </section>

          <section className="section chart-row">
            <ColumnChart
              title="Jobs dispatched per week"
              subtitle="Last 8 weeks, Monday to Sunday"
              labelHeading="Week"
              valueHeading="Jobs"
              data={k.throughput.weekly.map((w) => ({
                key: w.weekStart,
                label: formatDayMonth(w.weekStart),
                value: w.jobs,
                description: `Week of ${formatDate(w.weekStart)}: ${plural(w.jobs, 'job')}, ${fmtM2(w.areaM2)}`,
              }))}
            />
            <BarList
              title="Remakes by reason"
              subtitle={`All remakes flagged in the last ${k.periodDays} days`}
              labelHeading="Reason"
              valueHeading="Remakes"
              empty="No remakes in this period."
              data={k.remakes.byReason.map((r) => ({
                key: r.reason,
                label: REMAKE_REASON_LABELS[r.reason],
                value: r.count,
                description: `${REMAKE_REASON_LABELS[r.reason]}: ${plural(r.count, 'remake')}`,
              }))}
            />
          </section>
        </div>
      )}
    </>
  )
}
