// A printable A4 dispatch docket. The QR code opens the client's tracking page.
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EDGE_PROFILE_LABELS } from '../../../shared/catalog'
import type { JobDetail } from '../../../shared/types'
import { useAuth } from '../auth'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { StoneSwatch } from '../components/StoneSwatch'
import { fmtM2, fmtSize, formatDateTime, formatLongDate } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const SIDE_SHORT = { front: 'F', back: 'B', left: 'L', right: 'R' } as const

export function DocketPage() {
  const { id } = useParams()
  const { meta } = useAuth()
  const job = useApi<JobDetail>(`/jobs/${id}`)
  const [qr, setQr] = useState<string | null>(null)
  const j = job.data
  useDocumentTitle(j ? `Docket ${j.jobNumber}` : 'Docket')
  const trackUrl = j ? `${window.location.origin}/track/${j.shareToken}` : ''

  useEffect(() => {
    if (!trackUrl) return
    QRCode.toDataURL(trackUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null))
  }, [trackUrl])

  if (job.error) return <ErrorNotice error={job.error} onRetry={job.reload} />
  if (!j) return <Loading />

  const qc = [...j.events].reverse().find((e) => e.eventType === 'advanced' && e.fromStage === 'quality_check')
  const dispatched = [...j.events].reverse().find((e) => e.toStage === 'dispatched')

  return (
    <div className="docket-page">
      <div className="docket-toolbar">
        <Link to={`/jobs/${j.id}`} className="button button-quiet">
          <Icon name="back" />
          Back to {j.jobNumber}
        </Link>
        <button type="button" className="button button-primary" onClick={() => window.print()}>
          <Icon name="print" />
          Print docket
        </button>
      </div>

      <article className="docket">
        <header className="docket-head">
          <div>
            <p className="docket-factory">{meta?.factoryName ?? 'StoneTrack Demo Factory'}</p>
            <p className="docket-address">Unit 7, 120 Sample Road, Demo Park VIC. Phone 03 5550 0100.</p>
          </div>
          <div className="docket-title">
            <h1>Dispatch docket</h1>
            <p>
              Docket D-{j.jobNumber.replace('J-', '')} for job <strong>{j.jobNumber}</strong>
            </p>
          </div>
        </header>

        <section className="docket-parties">
          <div>
            <h2>Client</h2>
            <p className="docket-strong">{j.clientName}</p>
            <p>{[j.clientPhone, j.clientEmail].filter(Boolean).join(', ')}</p>
          </div>
          <div>
            <h2>Deliver to</h2>
            <p className="docket-strong">{j.siteAddress ?? 'Address to be confirmed'}</p>
            <p>Due {formatLongDate(j.dueDate)}</p>
          </div>
          <div className="docket-qr">
            {qr && <img src={qr} alt={`QR code for the tracking page of ${j.jobNumber}`} width={96} height={96} />}
            <p>Scan to track this order</p>
          </div>
        </section>

        <section className="docket-stone">
          <StoneSwatch hex={j.swatchHex} type={j.materialType} seed={j.materialCode} className="docket-swatch" />
          <p>
            <span className="docket-strong">{j.material.name}</span> ({j.material.code}), {j.material.finish}, {j.material.thicknessMm} mm. Drawing {j.drawingRef}.
          </p>
        </section>

        <table className="docket-table">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Piece</th>
              <th scope="col" className="num">
                Size (mm)
              </th>
              <th scope="col">Edge</th>
              <th scope="col" className="num">
                Cutouts
              </th>
              <th scope="col" className="check-col">
                Loaded
              </th>
            </tr>
          </thead>
          <tbody>
            {j.cuttingList.items.map((item) => {
              const piece = j.pieces[item.pieceIndex]
              return (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td>{item.pieceName}</td>
                  <td className="num">{fmtSize(item.lengthMm, item.widthMm)}</td>
                  <td>
                    {piece.polishedEdges.length ? `${EDGE_PROFILE_LABELS[piece.edgeProfile]} (${piece.polishedEdges.map((s) => SIDE_SHORT[s]).join(' ')})` : 'Unpolished'}
                  </td>
                  <td className="num">{item.cutouts || ''}</td>
                  <td className="check-col">
                    <span className="box" />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                {j.cuttingList.totals.parts} parts, {fmtM2(j.cuttingList.totals.areaM2)}
              </td>
              <td colSpan={4} className="muted">
                Edges: F front, B back, L left, R right
              </td>
            </tr>
          </tfoot>
        </table>

        <section className="docket-checks">
          <h2>Before the truck leaves</h2>
          <ul>
            <li>
              <span className="box" /> Every part wrapped, edges and corners protected
            </li>
            <li>
              <span className="box" /> Parts strapped upright on the A-frame
            </li>
            <li>
              <span className="box" /> Cutouts checked against the drawing
            </li>
            <li>
              <span className="box" /> Care and sealing guide included
            </li>
          </ul>
          <p className="docket-qc">
            Quality check: {qc ? `passed ${formatDateTime(qc.createdAt)}${qc.operatorName ? ` by ${qc.operatorName}` : ''}` : 'not yet done'}.
            {dispatched && ` Dispatched ${formatDateTime(dispatched.createdAt)}.`}
          </p>
        </section>

        <section className="docket-signatures">
          <div>
            <span className="sign-line" />
            <p>Driver: name, signature and date</p>
          </div>
          <div>
            <span className="sign-line" />
            <p>Received by: name, signature and date</p>
          </div>
        </section>
      </article>
    </div>
  )
}
