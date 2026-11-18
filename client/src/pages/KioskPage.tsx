// The factory-floor kiosk: a tablet screen with big targets. Pick a job (tiles carry
// the stone's colour so they match the slab on the rack), then complete its stage or
// flag a remake. It refreshes every 30 seconds so several kiosks stay in step.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ADVANCE_ACTIONS, STAGE_LABELS, WORK_STAGES, canFlagRemake, nextStage, type WorkStage } from '../../../shared/stages'
import type { KioskJob, Operator } from '../../../shared/types'
import { useAuth } from '../auth'
import { DueDate, PriorityTag, StageRail } from '../components/Badges'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { AdvanceForm, RemakeForm } from '../components/StageActions'
import { StoneSwatch } from '../components/StoneSwatch'
import { useToast } from '../components/Toast'
import { fmtSize, formatAgo, formatTime, plural } from '../format'
import { useApi, useDocumentTitle, useInterval } from '../hooks'

type Filter = WorkStage | 'all'
const FILTER_KEY = 'stonetrack.kiosk.station'
const SHORT_LABELS: Record<WorkStage, string> = {
  slab_allocation: 'Slabs',
  cutting: 'Cutting',
  finishing: 'Finishing',
  quality_check: 'QC',
  dispatch: 'Dispatch',
}

function savedFilter(): Filter {
  try {
    const value = localStorage.getItem(FILTER_KEY)
    return value && (WORK_STAGES as readonly string[]).includes(value) ? (value as WorkStage) : 'all'
  } catch {
    return 'all'
  }
}

function Clock() {
  const [now, setNow] = useState(() => new Date().toISOString())
  useInterval(useCallback(() => setNow(new Date().toISOString()), []), 15_000)
  return <span className="kiosk-clock">{formatTime(now)}</span>
}

export function KioskPage() {
  useDocumentTitle('Kiosk')
  const { user, logout } = useAuth()
  const toast = useToast()
  const jobs = useApi<KioskJob[]>('/kiosk/jobs')
  const operators = useApi<Operator[]>('/operators')
  const [filter, setFilter] = useState<Filter>(savedFilter)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mode, setMode] = useState<'view' | 'advance' | 'remake'>('view')
  useInterval(jobs.reload, 30_000)

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, filter) // each tablet remembers its station
    } catch {
      // storage unavailable: the filter just resets on reload
    }
  }, [filter])

  const list = jobs.data ?? []
  const visible = filter === 'all' ? list : list.filter((j) => j.stage === filter)
  const selected = list.find((j) => j.id === selectedId) ?? null

  function close() {
    setSelectedId(null)
    setMode('view')
  }

  return (
    <div className="kiosk">
      <header className="kiosk-bar">
        <span className="kiosk-brand">
          <span className="brand-mark" aria-hidden="true" />
          Kiosk
        </span>
        <nav className="kiosk-stations" aria-label="Station">
          {(['all', ...WORK_STAGES] as Filter[]).map((f) => {
            const count = f === 'all' ? list.length : list.filter((j) => j.stage === f).length
            return (
              <button key={f} type="button" className={filter === f ? 'is-selected' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All jobs' : SHORT_LABELS[f]}
                <span className="kiosk-count">{count}</span>
              </button>
            )
          })}
        </nav>
        <span className="kiosk-tools">
          <Clock />
          <button type="button" className="kiosk-icon" onClick={jobs.reload} aria-label="Refresh">
            <Icon name="refresh" size={24} />
          </button>
          {user?.role === 'kiosk' ? (
            <button type="button" className="kiosk-text" onClick={() => void logout()}>
              Sign out
            </button>
          ) : (
            <Link to="/dashboard" className="kiosk-text">
              Back to office
            </Link>
          )}
        </span>
      </header>

      <main className="kiosk-main">
        {jobs.error && <ErrorNotice error={jobs.error} onRetry={jobs.reload} />}
        {!jobs.data && jobs.loading && <Loading />}
        {jobs.data && visible.length === 0 && (
          <p className="kiosk-empty">{filter === 'all' ? 'No jobs in the factory.' : `Nothing waiting at ${STAGE_LABELS[filter]}.`}</p>
        )}
        <ul className="kiosk-tiles">
          {visible.map((job) => (
            <li key={job.id}>
              <button type="button" className="kiosk-tile" onClick={() => setSelectedId(job.id)}>
                <StoneSwatch hex={job.swatchHex} type={job.materialType} seed={job.materialCode} className="kiosk-tile-stone" />
                <span className="kiosk-tile-body">
                  <span className="kiosk-tile-top">
                    <span className="kiosk-job">{job.jobNumber}</span>
                    <PriorityTag priority={job.priority} />
                  </span>
                  <span className="kiosk-client">{job.clientName}</span>
                  <span className="kiosk-stone">
                    {job.materialName}, {plural(job.partCount, 'part')}
                  </span>
                  <StageRail stage={job.stage} />
                  <DueDate date={job.dueDate} inline />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      {selected && (
        <div className="kiosk-panel" role="dialog" aria-modal="true" aria-labelledby="kiosk-panel-title">
          <div className="kiosk-panel-head">
            <button type="button" className="kiosk-back" onClick={mode === 'view' ? close : () => setMode('view')}>
              <Icon name="back" size={26} />
              {mode === 'view' ? 'All jobs' : 'Back'}
            </button>
            <StoneSwatch hex={selected.swatchHex} type={selected.materialType} seed={selected.materialCode} className="kiosk-panel-stone" />
            <div>
              <h1 id="kiosk-panel-title" className="kiosk-panel-title">
                {selected.jobNumber} <span>{selected.clientName}</span>
              </h1>
              <p className="kiosk-panel-sub">
                {selected.materialName}. Moved to {STAGE_LABELS[selected.stage]} {formatAgo(selected.stageUpdatedAt)}.
              </p>
            </div>
          </div>

          <div className="kiosk-panel-body">
            {mode === 'view' && (
              <>
                <StageRail stage={selected.stage} />
                <ul className="kiosk-pieces">
                  {selected.pieces.map((p) => (
                    <li key={p.id}>
                      <span>{p.name}</span>
                      <span>
                        {fmtSize(p.lengthMm, p.widthMm)} mm{p.quantity > 1 ? `, × ${p.quantity}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {selected.stage === 'slab_allocation' && (
                  <p className="kiosk-hint">
                    Needs {plural(selected.slabsRequired, 'slab')}, {selected.slabsAllocated} allocated. Completing this stage picks the rest from stock.
                  </p>
                )}
                <div className="kiosk-actions">
                  <button type="button" className="button button-go kiosk-action" onClick={() => setMode('advance')}>
                    <Icon name="check" size={32} />
                    <span>
                      {ADVANCE_ACTIONS[selected.stage as WorkStage]}
                      <small>Next: {STAGE_LABELS[nextStage(selected.stage)!]}</small>
                    </span>
                  </button>
                  {canFlagRemake(selected.stage) && (
                    <button type="button" className="button button-caution kiosk-action" onClick={() => setMode('remake')}>
                      <Icon name="remake" size={32} />
                      <span>
                        Flag a remake
                        <small>Sends the job back to Cutting</small>
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
            {mode === 'advance' && (
              <AdvanceForm
                job={selected}
                operators={operators.data ?? []}
                requireOperator
                onDone={(result) => {
                  toast(`${result.job.jobNumber} moved to ${STAGE_LABELS[result.job.stage]}${result.allocatedSlabs.length ? `. Slabs ${result.allocatedSlabs.join(', ')} allocated` : ''}`)
                  close()
                  jobs.reload()
                }}
              />
            )}
            {mode === 'remake' && (
              <RemakeForm
                job={selected}
                operators={operators.data ?? []}
                onDone={() => {
                  toast(`${selected.jobNumber} sent back to Cutting`)
                  close()
                  jobs.reload()
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

