// The client's tracking page, opened from a share link. No sign-in, progress only.
import { useParams } from 'react-router'
import { STAGE_DESCRIPTIONS, type Stage } from '../../../shared/stages'
import type { PublicJobStatus } from '../../../shared/types'
import { Loading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { StoneSwatch } from '../components/StoneSwatch'
import { formatDateTime, formatLongDate } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const BAND_TEXTURE = { w: 560, h: 120 }

// Headlines in the client's words rather than the factory's.
const HEADLINES: Record<Stage, string> = {
  slab_allocation: 'Picking your stone',
  cutting: 'Cutting your pieces',
  finishing: 'Finishing edges and cutouts',
  quality_check: 'Final quality check',
  dispatch: 'Ready for delivery',
  dispatched: 'On its way',
}

export function TrackPage() {
  const { token } = useParams()
  const status = useApi<PublicJobStatus>(`/public/jobs/${encodeURIComponent(token ?? '')}`)
  const s = status.data
  useDocumentTitle(s ? `Order ${s.jobNumber}` : 'Track your order')

  if (status.error) {
    return (
      <main className="track">
        <div className="track-card track-missing">
          <h1>We can't find this order</h1>
          <p>
            {status.error.status === 404
              ? 'This tracking link isn’t valid. It may have been replaced with a new one. Ask your benchtop supplier to send the current link.'
              : status.error.message}
          </p>
        </div>
      </main>
    )
  }
  if (!s) return <Loading />

  const headline = HEADLINES[s.stage]
  return (
    <main className="track">
      <div className="track-card">
        <StoneSwatch hex={s.swatchHex} type={s.materialType} seed={s.materialCode} className="track-stone" label={`${s.materialName} stone`} size={BAND_TEXTURE} />
        <header className="track-head">
          <p className="track-order">Order {s.jobNumber}</p>
          <h1>{headline}</h1>
          <p className="track-lead">{STAGE_DESCRIPTIONS[s.stage]}</p>
          <dl className="track-facts">
            <div>
              <dt>For</dt>
              <dd>{s.clientName}</dd>
            </div>
            <div>
              <dt>Stone</dt>
              <dd>{s.materialName}</dd>
            </div>
            <div>
              <dt>Pieces</dt>
              <dd>{s.partCount}</dd>
            </div>
            <div>
              <dt>{s.dispatchedAt ? 'Dispatched' : 'Due to leave the factory'}</dt>
              <dd>{s.dispatchedAt ? formatDateTime(s.dispatchedAt) : formatLongDate(s.dueDate)}</dd>
            </div>
          </dl>
        </header>
        <ol className="track-steps">
          {s.timeline.map((step) => (
            <li key={step.stage} className={`track-step is-${step.state}`}>
              <span className="track-dot" aria-hidden="true">
                {step.state === 'done' && <Icon name="check" size={14} />}
              </span>
              <span className="track-step-name">
                {step.label}
                {step.state === 'current' && <span className="visually-hidden"> (current step)</span>}
              </span>
              <span className="track-step-time">{step.reachedAt ? formatDateTime(step.reachedAt) : ''}</span>
            </li>
          ))}
        </ol>
        <p className="track-updated">Last updated {formatDateTime(s.lastUpdated)}. This page shows live progress from the factory floor.</p>
      </div>
    </main>
  )
}
