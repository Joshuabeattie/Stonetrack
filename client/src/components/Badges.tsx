// Small status displays. Colour is never the only signal: each one pairs an icon with words.
import { STAGE_LABELS, WORK_STAGES, stageIndex, type Stage } from '../../../shared/stages'
import type { CapacityStatus } from '../../../shared/types'
import { dueStatus, formatDate } from '../format'
import { Icon } from './Icon'

/** Five segments, one per stage: filled = done, hatched = in progress, empty = still to come. */
export function StageRail({ stage, showLabel = true }: { stage: Stage; showLabel?: boolean }) {
  const current = stageIndex(stage)
  const finished = stage === 'dispatched'
  return (
    <span className="stage-rail" title={STAGE_LABELS[stage]}>
      <span className="stage-rail-track" role="img" aria-label={finished ? 'Dispatched' : `${STAGE_LABELS[stage]}, stage ${current + 1} of 5`}>
        {WORK_STAGES.map((s, i) => (
          <span key={s} className={`stage-rail-seg ${finished || i < current ? 'is-done' : i === current ? 'is-current' : ''}`} />
        ))}
      </span>
      {showLabel && <span className="stage-rail-label">{STAGE_LABELS[stage]}</span>}
    </span>
  )
}

const CAPACITY_STATUS: Record<CapacityStatus, { label: string; icon: 'alert' | 'warning' | 'check' }> = {
  late: { label: 'Late', icon: 'alert' },
  at_risk: { label: 'At risk', icon: 'warning' },
  on_track: { label: 'On track', icon: 'check' },
}

export function StatusBadge({ status }: { status: CapacityStatus }) {
  const s = CAPACITY_STATUS[status]
  return (
    <span className={`status status-${status}`}>
      <Icon name={s.icon} size={15} />
      {s.label}
    </span>
  )
}

/** "Fri 20 Nov" with "in 2 days" / "2 days overdue" underneath. */
export function DueDate({ date, done = false, inline = false }: { date: string; done?: boolean; inline?: boolean }) {
  const status = dueStatus(date, done)
  return (
    <span className={`due due-${status.tone} ${inline ? 'due-inline' : ''}`}>
      <span className="due-date">{formatDate(date)}</span>
      {!done && (
        <span className="due-rel">
          {status.tone === 'overdue' && <Icon name="alert" size={14} />}
          {status.text}
        </span>
      )}
    </span>
  )
}

export function PriorityTag({ priority }: { priority: 'normal' | 'urgent' }) {
  if (priority !== 'urgent') return null
  return <span className="tag tag-urgent">Urgent</span>
}
