import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { MATERIAL_TYPE_LABELS, REMAKE_REASON_LABELS } from '../../../shared/catalog'
import { STAGES, STAGE_LABELS, canFlagRemake, stageIndex, ADVANCE_ACTIONS, type Stage, type WorkStage } from '../../../shared/stages'
import type { JobDetail, Operator, Slab, StageEvent } from '../../../shared/types'
import { api, ApiError } from '../api'
import { DueDate, PriorityTag } from '../components/Badges'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { SlabLayout } from '../components/SlabLayout'
import { AdvanceForm, RemakeForm } from '../components/StageActions'
import { StoneSwatch } from '../components/StoneSwatch'
import { useToast } from '../components/Toast'
import { fmtHours, fmtM2, fmtSize, formatDateTime, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

type Dialog = 'advance' | 'remake' | 'edit' | 'new-link' | null

/** When the job last entered each stage, from its history. */
function stageTimes(events: StageEvent[]) {
  const entered = new Map<Stage, StageEvent>()
  for (const e of events) entered.set(e.toStage, e)
  return entered
}

function eventText(e: StageEvent): string {
  if (e.eventType === 'created') return 'Job created'
  if (e.eventType === 'remake') return `Remake: ${REMAKE_REASON_LABELS[e.remakeReason!]}${e.pieceName ? ` (${e.pieceName})` : ''}`
  if (e.toStage === 'dispatched') return 'Dispatched'
  return `${STAGE_LABELS[e.fromStage!]} done`
}

export function JobDetailPage() {
  const { id } = useParams()
  const toast = useToast()
  const job = useApi<JobDetail>(`/jobs/${id}`)
  const operators = useApi<Operator[]>('/operators')
  const j = job.data
  const available = useApi<Slab[]>(j && j.stage !== 'dispatched' ? `/slabs?status=available&materialId=${j.material.id}` : null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [actionError, setActionError] = useState<ApiError | null>(null)
  useDocumentTitle(j ? `${j.jobNumber} ${j.clientName}` : 'Job')

  if (job.error && !j) return <ErrorNotice error={job.error} onRetry={job.reload} />
  if (!j) return <Loading />

  const refresh = () => {
    job.reload()
    available.reload()
  }
  const trackUrl = `${window.location.origin}/track/${j.shareToken}`
  const entered = stageTimes(j.events)
  const current = stageIndex(j.stage)
  const stageJob = {
    id: j.id,
    jobNumber: j.jobNumber,
    stage: j.stage,
    standardHours: j.stage === 'dispatched' ? 0 : j.cuttingList.hours.labour[j.stage as WorkStage],
    pieces: j.pieces.map((p) => ({ id: p.id, name: p.name, quantity: p.quantity })),
  }

  async function run(action: () => Promise<string>) {
    setActionError(null)
    try {
      toast(await action())
      refresh()
    } catch (err) {
      setActionError(err as ApiError)
    }
  }

  const allocateAuto = () =>
    run(async () => {
      const res = await api<{ allocated: string[] }>(`/jobs/${j.id}/allocate`, { method: 'POST', body: {} })
      return `Allocated ${res.allocated.join(', ')} to ${j.jobNumber}`
    })
  const allocateOne = (slabId: number) =>
    run(async () => {
      const res = await api<{ allocated: string[] }>(`/jobs/${j.id}/allocate`, { method: 'POST', body: { slabIds: [slabId] } })
      return `Allocated ${res.allocated.join(', ')} to ${j.jobNumber}`
    })
  const release = (slab: Slab) =>
    run(async () => {
      await api(`/slabs/${slab.id}/release`, { method: 'POST' })
      return `${slab.code} returned to stock`
    })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackUrl)
      toast('Client link copied')
    } catch {
      toast('Copy blocked by the browser. Select the link and copy it instead.', 'error')
    }
  }

  const slabsHeld = j.slabs.length
  const slabsNeeded = j.cuttingList.totals.slabsRequired

  return (
    <div className={job.loading ? 'is-refreshing' : ''}>
      <div className="job-head">
        <StoneSwatch hex={j.swatchHex} type={j.materialType} seed={j.materialCode} className="job-head-stone" label={`${j.materialName} stone`} />
        <div className="job-head-main">
          <p className="crumb">
            <Link to="/jobs">Jobs</Link>
          </p>
          <h1 className="job-title">
            <span className="job-number">{j.jobNumber}</span> {j.clientName}
          </h1>
          <div className="job-meta">
            <PriorityTag priority={j.priority} />
            {j.source === 'webhook' && <span className="tag">From quoting portal {j.externalRef}</span>}
            <span>
              {j.material.name}, {MATERIAL_TYPE_LABELS[j.material.materialType].toLowerCase()}, {j.material.thicknessMm} mm
            </span>
            <span>Drawing {j.drawingRef}</span>
            <DueDate date={j.dueDate} done={j.stage === 'dispatched'} inline />
          </div>
        </div>
        <div className="job-actions">
          {j.stage !== 'dispatched' && (
            <button type="button" className="button button-go" onClick={() => setDialog('advance')}>
              <Icon name="check" />
              {ADVANCE_ACTIONS[j.stage as WorkStage]}
            </button>
          )}
          {canFlagRemake(j.stage) && (
            <button type="button" className="button button-caution" onClick={() => setDialog('remake')}>
              <Icon name="remake" />
              Flag a remake
            </button>
          )}
          <Link to={`/jobs/${j.id}/docket`} className="button button-quiet">
            <Icon name="print" />
            Dispatch docket
          </Link>
          {j.stage !== 'dispatched' && (
            <button type="button" className="button button-quiet" onClick={() => setDialog('edit')}>
              Edit details
            </button>
          )}
        </div>
      </div>

      {actionError && <ErrorNotice error={actionError} />}

      <section className="section" aria-labelledby="progress-heading">
        <h2 id="progress-heading" className="section-title">
          Progress
        </h2>
        <ol className="stations">
          {STAGES.map((s, i) => {
            const state = j.stage === 'dispatched' || i < current ? 'done' : i === current ? 'current' : 'upcoming'
            const e = i <= current ? entered.get(s) : undefined
            return (
              <li key={s} className={`station station-${state}`}>
                <span className="station-name">{STAGE_LABELS[s]}</span>
                <span className="station-time">{e ? formatDateTime(e.createdAt) : state === 'upcoming' ? 'Not started' : ''}</span>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="detail-grid">
        <section className="section" aria-labelledby="cutting-heading">
          <h2 id="cutting-heading" className="section-title">
            Cutting list
          </h2>
          <dl className="totals">
            <div>
              <dt>Parts</dt>
              <dd>{j.cuttingList.totals.parts}</dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd>{fmtM2(j.cuttingList.totals.areaM2)}</dd>
            </div>
            <div>
              <dt>Polished edge</dt>
              <dd>{j.cuttingList.totals.polishedEdgeM.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>Standard labour</dt>
              <dd>{fmtHours(j.cuttingList.hours.labourTotal)}</dd>
            </div>
          </dl>
          <SlabLayout list={j.cuttingList} stone={{ ...j.material }} />
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Piece</th>
                  <th scope="col" className="num">
                    Size (mm)
                  </th>
                  <th scope="col">Edges</th>
                  <th scope="col" className="num">
                    Cutouts
                  </th>
                </tr>
              </thead>
              <tbody>
                {j.cuttingList.items.map((item) => (
                  <tr key={item.label}>
                    <td className="code">{item.label}</td>
                    <td>{item.pieceName}</td>
                    <td className="num">{fmtSize(item.lengthMm, item.widthMm)}</td>
                    <td>{item.polishedEdgeM > 0 ? `${item.edgeProfileLabel}, ${item.polishedEdgeM.toFixed(2)} m` : 'None'}</td>
                    <td className="num">{item.cutouts || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="detail-side">
          <section className="section" aria-labelledby="slabs-heading">
            <h2 id="slabs-heading" className="section-title">
              Slabs
            </h2>
            <p className="muted">
              {slabsHeld} of {plural(slabsNeeded, 'slab')} allocated.
              {j.stage === 'slab_allocation' && slabsHeld < slabsNeeded && ' Completing slab allocation picks the rest automatically, oldest stock first.'}
            </p>
            {j.slabs.length > 0 && (
              <ul className="slab-list">
                {j.slabs.map((s) => (
                  <li key={s.id}>
                    <span className="code">{s.code}</span>
                    <span>{s.status === 'consumed' ? 'Cut' : 'Allocated'}</span>
                    <span className="muted">Rack {s.rackLocation ?? 'not set'}</span>
                    {s.status === 'allocated' && (
                      <button type="button" className="link-button" onClick={() => void release(s)}>
                        Return to stock
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {j.stage !== 'dispatched' && (
              <div className="slab-actions">
                {slabsHeld < slabsNeeded && (
                  <button type="button" className="button button-quiet" onClick={() => void allocateAuto()}>
                    Allocate automatically
                  </button>
                )}
                {available.data && available.data.length > 0 && (
                  <label className="filter">
                    <span className="visually-hidden">Add a specific slab</span>
                    <select value="" onChange={(e) => e.target.value && void allocateOne(Number(e.target.value))}>
                      <option value="">Add a specific slab</option>
                      {available.data.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code}, rack {s.rackLocation ?? 'not set'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {available.data && available.data.length === 0 && <p className="muted">No {j.material.name} slabs in stock.</p>}
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="client-link-heading">
            <h2 id="client-link-heading" className="section-title">
              Client tracking link
            </h2>
            <p className="muted">Anyone with this link can see the job's progress, with no internal details.</p>
            <div className="share">
              <input readOnly value={trackUrl} aria-label="Client tracking link" onFocus={(e) => e.target.select()} />
              <button type="button" className="button button-quiet" onClick={() => void copyLink()}>
                <Icon name="copy" />
                Copy
              </button>
            </div>
            <p>
              <a href={`/track/${j.shareToken}`} target="_blank" rel="noreferrer">
                Open the client page
              </a>
              {' or '}
              <button type="button" className="link-button" onClick={() => setDialog('new-link')}>
                replace the link
              </button>
            </p>
          </section>

          <section className="section" aria-labelledby="details-heading">
            <h2 id="details-heading" className="section-title">
              Details
            </h2>
            <dl className="details">
              <dt>Delivery address</dt>
              <dd>{j.siteAddress ?? 'Not set'}</dd>
              <dt>Contact</dt>
              <dd>{[j.clientEmail, j.clientPhone].filter(Boolean).join(', ') || 'Not set'}</dd>
              <dt>Notes</dt>
              <dd>{j.notes ?? 'None'}</dd>
              <dt>Created</dt>
              <dd>
                {formatDateTime(j.createdAt)}
                {j.createdByName ? ` by ${j.createdByName}` : j.source === 'webhook' ? ' by webhook' : ''}
              </dd>
            </dl>
          </section>
        </div>
      </div>

      <section className="section" aria-labelledby="history-heading">
        <h2 id="history-heading" className="section-title">
          History
        </h2>
        <ol className="history">
          {[...j.events].reverse().map((e) => (
            <li key={e.id} className={`history-item history-${e.eventType}`}>
              <span className="history-time">{formatDateTime(e.createdAt)}</span>
              <span className="history-what">{eventText(e)}</span>
              <span className="history-who">
                {[e.operatorName, e.labourHours !== null ? `${e.labourHours.toFixed(2)} labour hours` : null, e.note].filter(Boolean).join(', ')}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Modal open={dialog === 'advance'} title={`${j.jobNumber}: ${STAGE_LABELS[j.stage]}`} onClose={() => setDialog(null)}>
        <AdvanceForm
          job={stageJob}
          operators={operators.data ?? []}
          onDone={(result) => {
            setDialog(null)
            toast(`${result.job.jobNumber} moved to ${STAGE_LABELS[result.job.stage]}${result.allocatedSlabs.length ? `. Allocated ${result.allocatedSlabs.join(', ')}` : ''}`)
            refresh()
          }}
        />
      </Modal>
      <Modal open={dialog === 'remake'} title={`Flag a remake on ${j.jobNumber}`} onClose={() => setDialog(null)}>
        <RemakeForm
          job={stageJob}
          operators={operators.data ?? []}
          onDone={() => {
            setDialog(null)
            toast(`${j.jobNumber} sent back to Cutting`)
            refresh()
          }}
        />
      </Modal>
      <Modal open={dialog === 'edit'} title={`Edit ${j.jobNumber}`} onClose={() => setDialog(null)}>
        <EditForm
          job={j}
          onDone={() => {
            setDialog(null)
            toast(`${j.jobNumber} updated`)
            refresh()
          }}
        />
      </Modal>
      <Modal open={dialog === 'new-link'} title="Replace the client link?" onClose={() => setDialog(null)}>
        <p>The current link stops working straight away. Send the new link to the client.</p>
        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() =>
              void run(async () => {
                await api(`/jobs/${j.id}/share-token`, { method: 'POST' })
                setDialog(null)
                return 'New client link created'
              })
            }
          >
            Replace link
          </button>
          <button type="button" className="button button-quiet" onClick={() => setDialog(null)}>
            Keep current link
          </button>
        </div>
      </Modal>
    </div>
  )
}

function EditForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const [dueDate, setDueDate] = useState(job.dueDate)
  const [priority, setPriority] = useState(job.priority)
  const [siteAddress, setSiteAddress] = useState(job.siteAddress ?? '')
  const [notes, setNotes] = useState(job.notes ?? '')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/jobs/${job.id}`, { method: 'PATCH', body: { dueDate, priority, siteAddress, notes } })
      onDone()
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  const fieldErrors = error?.fieldErrors?.() ?? {}
  return (
    <form onSubmit={submit} className="form-grid">
      <Field label="Due date" error={fieldErrors.dueDate}>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Priority">
        <select value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'urgent')}>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </Field>
      <Field label="Delivery address" error={fieldErrors.siteAddress} className="span-2">
        <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
      </Field>
      <Field label="Notes" error={fieldErrors.notes} className="span-2">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && !Object.keys(fieldErrors).length && <ErrorNotice error={error} />}
      <div className="form-actions span-2">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Saving' : 'Save changes'}
        </button>
      </div>
      {/* Pieces are fixed once a job exists, because the cutting list and slabs depend on them. */}
      <p className="muted span-2">Pieces can't be changed after intake. If the order changes, create a new job.</p>
    </form>
  )
}

