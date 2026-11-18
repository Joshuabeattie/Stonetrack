// The two things that move a job on the floor: completing its stage, and flagging a
// remake. Used by the kiosk (large) and the job page (normal size).
import { useState, type FormEvent } from 'react'
import { OPERATOR_TEAM_LABELS, REMAKE_REASONS, REMAKE_REASON_LABELS, type RemakeReason } from '../../../shared/catalog'
import { ADVANCE_ACTIONS, REMAKE_RETURN_STAGE, STAGE_LABELS, nextStage, type Stage, type WorkStage } from '../../../shared/stages'
import type { AdvanceResult, Operator, StageEvent } from '../../../shared/types'
import { api, ApiError } from '../api'
import { ErrorNotice } from './Feedback'
import { Icon } from './Icon'

export interface StageJob {
  id: number
  jobNumber: string
  stage: Stage
  standardHours: number // standard labour for the current stage
  pieces: { id: number; name: string; quantity: number }[]
}

const quarter = (h: number) => Math.round(h * 4) / 4

function OperatorPicker({ operators, value, onChange, required }: { operators: Operator[]; value: number | null; onChange: (id: number) => void; required: boolean }) {
  return (
    <fieldset className="choices">
      <legend>
        Who did the work?{!required && <span className="optional"> Optional</span>}
      </legend>
      <div className="choice-grid">
        {operators.map((o) => (
          <label key={o.id} className={`choice ${value === o.id ? 'is-selected' : ''}`}>
            <input type="radio" name="operator" value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} required={required} />
            <span className="choice-main">{o.name}</span>
            <span className="choice-sub">{OPERATOR_TEAM_LABELS[o.team]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function AdvanceForm({
  job,
  operators,
  requireOperator = false,
  onDone,
}: {
  job: StageJob
  operators: Operator[]
  requireOperator?: boolean
  onDone: (result: AdvanceResult) => void
}) {
  const stage = job.stage as WorkStage
  const next = nextStage(job.stage)
  const [operatorId, setOperatorId] = useState<number | null>(null)
  const [hours, setHours] = useState(quarter(job.standardHours))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (requireOperator && operatorId === null) {
      setError(new ApiError(422, 'VALIDATION_ERROR', 'Choose who did the work.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api<AdvanceResult>(`/jobs/${job.id}/advance`, {
        method: 'POST',
        body: { expectedStage: job.stage, operatorId: operatorId ?? undefined, labourHours: hours, note: note || undefined },
      })
      onDone(result)
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  if (!next) return <p>This job has been dispatched.</p>
  return (
    <form className="stage-form" onSubmit={submit} noValidate>
      <OperatorPicker operators={operators} value={operatorId} onChange={setOperatorId} required={requireOperator} />
      <div className="hours">
        <span className="hours-label" id={`hours-${job.id}`}>
          Labour hours
        </span>
        <div className="stepper" role="group" aria-labelledby={`hours-${job.id}`}>
          <button type="button" className="stepper-button" onClick={() => setHours((h) => Math.max(0, quarter(h - 0.25)))} aria-label="A quarter hour less">
            <Icon name="minus" />
          </button>
          <output className="stepper-value" aria-live="polite">
            {hours.toFixed(2)} h
          </output>
          <button type="button" className="stepper-button" onClick={() => setHours((h) => Math.min(24, quarter(h + 0.25)))} aria-label="A quarter hour more">
            <Icon name="plus" />
          </button>
        </div>
        <span className="hours-hint">Standard time for {STAGE_LABELS[stage].toLowerCase()}: {job.standardHours.toFixed(2)} h</span>
      </div>
      <label className="note">
        <span>Note (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      {error && <ErrorNotice error={error} />}
      <div className="stage-form-actions">
        <button type="submit" className="button button-go button-big" disabled={busy}>
          <Icon name="check" size={22} />
          {busy ? 'Saving' : ADVANCE_ACTIONS[stage]}
        </button>
        <span className="stage-form-next">Moves {job.jobNumber} to {STAGE_LABELS[next]}</span>
      </div>
    </form>
  )
}

export function RemakeForm({
  job,
  operators,
  onDone,
}: {
  job: StageJob
  operators: Operator[]
  onDone: (result: { event: StageEvent; stage: Stage }) => void
}) {
  const [reason, setReason] = useState<RemakeReason | null>(null)
  const [pieceId, setPieceId] = useState<number | null>(null)
  const [operatorId, setOperatorId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!reason) {
      setError(new ApiError(422, 'VALIDATION_ERROR', 'Choose what went wrong.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ event: StageEvent; stage: Stage }>(`/jobs/${job.id}/remake`, {
        method: 'POST',
        body: { expectedStage: job.stage, reason, pieceId: pieceId ?? undefined, operatorId: operatorId ?? undefined, note: note || undefined },
      })
      onDone(result)
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stage-form" onSubmit={submit} noValidate>
      <fieldset className="choices">
        <legend>What went wrong?</legend>
        <div className="choice-grid">
          {REMAKE_REASONS.map((r) => (
            <label key={r} className={`choice ${reason === r ? 'is-selected' : ''}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span className="choice-main">{REMAKE_REASON_LABELS[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="choices">
        <legend>
          Which piece?<span className="optional"> Optional</span>
        </legend>
        <div className="choice-grid">
          {job.pieces.map((p) => (
            <label key={p.id} className={`choice ${pieceId === p.id ? 'is-selected' : ''}`}>
              <input type="radio" name="piece" value={p.id} checked={pieceId === p.id} onChange={() => setPieceId(p.id)} />
              <span className="choice-main">{p.name}</span>
              {p.quantity > 1 && <span className="choice-sub">× {p.quantity}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <OperatorPicker operators={operators} value={operatorId} onChange={setOperatorId} required={false} />
      <label className="note">
        <span>Note (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="For example: chip on the front edge near the sink" />
      </label>
      {error && <ErrorNotice error={error} />}
      <div className="stage-form-actions">
        <button type="submit" className="button button-caution button-big" disabled={busy}>
          <Icon name="remake" size={22} />
          {busy ? 'Saving' : `Send back to ${STAGE_LABELS[REMAKE_RETURN_STAGE].toLowerCase()}`}
        </button>
        <span className="stage-form-next">The job returns to {STAGE_LABELS[REMAKE_RETURN_STAGE]} and the reason is logged</span>
      </div>
    </form>
  )
}
