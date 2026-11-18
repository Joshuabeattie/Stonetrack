// Job intake. The cutting list on the right is generated live by the same function
// the server uses, so what you see is exactly what will be saved.
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  EDGE_PROFILES,
  EDGE_PROFILE_LABELS,
  EDGE_SIDES,
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  type EdgeProfile,
  type EdgeSide,
} from '../../../shared/catalog'
import { generateCuttingList, type PieceSpec } from '../../../shared/cuttingList'
import { addWorkingDays } from '../../../shared/dates'
import { jobInputSchema } from '../../../shared/schemas'
import { WORK_STAGES, STAGE_LABELS } from '../../../shared/stages'
import type { JobDetail, Material } from '../../../shared/types'
import { api, ApiError } from '../api'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { SlabLayout } from '../components/SlabLayout'
import { StoneSwatch } from '../components/StoneSwatch'
import { useToast } from '../components/Toast'
import { factoryToday, fmtHours, fmtM2, fmtSize, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

interface PieceDraft {
  key: number
  name: string
  lengthMm: string
  widthMm: string
  quantity: string
  edgeProfile: EdgeProfile
  polishedEdges: EdgeSide[]
  cutouts: string
}

const SIDE_LABELS: Record<EdgeSide, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' }

let nextKey = 1
const newPiece = (overrides: Partial<PieceDraft> = {}): PieceDraft => ({
  key: nextKey++,
  name: '',
  lengthMm: '',
  widthMm: '',
  quantity: '1',
  edgeProfile: 'pencil_round',
  polishedEdges: ['front'],
  cutouts: '0',
  ...overrides,
})

/** A draft piece as numbers, or null while it's incomplete (it's left out of the preview). */
function toSpec(p: PieceDraft): PieceSpec | null {
  const lengthMm = Number(p.lengthMm)
  const widthMm = Number(p.widthMm)
  const quantity = Number(p.quantity)
  if (!(lengthMm >= 100 && widthMm >= 50 && quantity >= 1)) return null
  return { name: p.name || 'Piece', lengthMm, widthMm, quantity, edgeProfile: p.edgeProfile, polishedEdges: p.polishedEdges, cutouts: Number(p.cutouts) || 0 }
}

export function NewJobPage() {
  useDocumentTitle('New job')
  const navigate = useNavigate()
  const toast = useToast()
  const materials = useApi<Material[]>('/materials')
  const clients = useApi<string[]>('/clients')
  const formRef = useRef<HTMLFormElement>(null)

  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [drawingRef, setDrawingRef] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [dueDate, setDueDate] = useState(() => addWorkingDays(factoryToday(), 10))
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [notes, setNotes] = useState('')
  const [pieces, setPieces] = useState<PieceDraft[]>(() => [
    newPiece({ name: 'Main bench', lengthMm: '2400', widthMm: '650', cutouts: '2' }),
  ])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const material = materials.data?.find((m) => m.id === Number(materialId)) ?? null
  const specs = pieces.map(toSpec).filter((p): p is PieceSpec => p !== null)
  // Cheap to compute (microseconds), so it simply runs on every render.
  const preview =
    material && specs.length > 0
      ? generateCuttingList(specs, { materialType: material.materialType, thicknessMm: material.thicknessMm, slabLengthMm: material.slabLengthMm, slabWidthMm: material.slabWidthMm })
      : null

  const updatePiece = (key: number, changes: Partial<PieceDraft>) => setPieces((list) => list.map((p) => (p.key === key ? { ...p, ...changes } : p)))
  const toggleSide = (piece: PieceDraft, side: EdgeSide) =>
    updatePiece(piece.key, {
      polishedEdges: piece.polishedEdges.includes(side) ? piece.polishedEdges.filter((s) => s !== side) : EDGE_SIDES.filter((s) => s === side || piece.polishedEdges.includes(s)),
    })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    const payload = {
      clientName,
      clientEmail,
      clientPhone,
      siteAddress,
      drawingRef,
      materialId: materialId || 0,
      dueDate,
      priority,
      notes,
      pieces: pieces.map((p) => ({
        name: p.name,
        lengthMm: p.lengthMm,
        widthMm: p.widthMm,
        quantity: p.quantity,
        edgeProfile: p.edgeProfile,
        polishedEdges: p.polishedEdges,
        cutouts: p.cutouts,
      })),
    }
    // Check in the browser first with the same rules the server uses.
    const checked = jobInputSchema.safeParse(payload)
    if (!checked.success) {
      const found: Record<string, string> = {}
      for (const issue of checked.error.issues) found[issue.path.map(String).join('.')] ??= issue.message
      setErrors(found)
      focusFirstError()
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const job = await api<JobDetail>('/jobs', { method: 'POST', body: checked.data })
      toast(`${job.jobNumber} created for ${job.clientName}`)
      navigate(`/jobs/${job.id}`)
    } catch (err) {
      const apiError = err as ApiError
      setErrors(apiError.fieldErrors?.() ?? {})
      setSubmitError(apiError)
      focusFirstError()
      setBusy(false)
    }
  }

  function focusFirstError() {
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }

  if (materials.error) return <ErrorNotice error={materials.error} onRetry={materials.reload} />
  if (!materials.data) return <Loading />

  return (
    <>
      <PageHeader title="New job" sub="Enter the order. The cutting list updates as you type." />
      <div className="intake">
        <form ref={formRef} className="intake-form" onSubmit={submit} noValidate>
          <fieldset className="form-section">
            <legend>Client</legend>
            <div className="form-grid">
              <Field label="Client name" error={errors.clientName} className="span-2">
                <input list="client-names" value={clientName} onChange={(e) => setClientName(e.target.value)} autoComplete="off" />
              </Field>
              <datalist id="client-names">
                {clients.data?.map((name) => <option key={name} value={name} />)}
              </datalist>
              <Field label="Email (optional)" error={errors.clientEmail}>
                <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
              </Field>
              <Field label="Phone (optional)" error={errors.clientPhone}>
                <input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
              </Field>
              <Field label="Delivery address (optional)" error={errors.siteAddress} className="span-2">
                <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Order</legend>
            <div className="form-grid">
              <Field label="Stone" error={errors.materialId} className="span-2">
                <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                  <option value="">Choose a stone</option>
                  {MATERIAL_TYPES.map((type) => {
                    const options = materials.data!.filter((m) => m.materialType === type)
                    if (options.length === 0) return null
                    return (
                      <optgroup key={type} label={MATERIAL_TYPE_LABELS[type]}>
                        {options.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}, {m.finish}, {m.thicknessMm} mm
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </Field>
              <Field label="Drawing reference" error={errors.drawingRef} hint="As written on the template or drawing, e.g. DWG-4471 Rev B">
                <input value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} />
              </Field>
              <Field label="Due date" error={errors.dueDate} hint="The day it must leave the factory">
                <input type="date" value={dueDate} min={factoryToday()} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <fieldset className="field span-2">
                <legend className="field-label">Priority</legend>
                <div className="segmented">
                  {(['normal', 'urgent'] as const).map((p) => (
                    <label key={p} className={priority === p ? 'is-selected' : ''}>
                      <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} />
                      {p === 'normal' ? 'Normal' : 'Urgent'}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Notes for the factory (optional)" error={errors.notes} className="span-2">
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Pieces</legend>
            {errors.pieces && <p className="field-error">{errors.pieces}</p>}
            <ol className="pieces">
              {pieces.map((piece, i) => {
                const err = (field: string) => errors[`pieces.${i}.${field}`]
                return (
                  <li key={piece.key} className="piece">
                    <div className="piece-head">
                      <span className="piece-number">P{i + 1}</span>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setPieces((list) => list.filter((p) => p.key !== piece.key))}
                        disabled={pieces.length === 1}
                        aria-label={`Remove piece ${i + 1}`}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                    <div className="piece-grid">
                      <Field label="Name" error={err('name')} className="piece-name">
                        <input value={piece.name} onChange={(e) => updatePiece(piece.key, { name: e.target.value })} placeholder="e.g. Island bench" />
                      </Field>
                      <Field label="Length (mm)" error={err('lengthMm')}>
                        <input inputMode="numeric" value={piece.lengthMm} onChange={(e) => updatePiece(piece.key, { lengthMm: e.target.value })} />
                      </Field>
                      <Field label="Width (mm)" error={err('widthMm')}>
                        <input inputMode="numeric" value={piece.widthMm} onChange={(e) => updatePiece(piece.key, { widthMm: e.target.value })} />
                      </Field>
                      <Field label="Quantity" error={err('quantity')}>
                        <input inputMode="numeric" value={piece.quantity} onChange={(e) => updatePiece(piece.key, { quantity: e.target.value })} />
                      </Field>
                      <Field label="Edge profile" error={err('edgeProfile')}>
                        <select value={piece.edgeProfile} onChange={(e) => updatePiece(piece.key, { edgeProfile: e.target.value as EdgeProfile })}>
                          {EDGE_PROFILES.map((p) => (
                            <option key={p} value={p}>
                              {EDGE_PROFILE_LABELS[p]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Cutouts" error={err('cutouts')} hint="Sink, cooktop, tap holes">
                        <input inputMode="numeric" value={piece.cutouts} onChange={(e) => updatePiece(piece.key, { cutouts: e.target.value })} />
                      </Field>
                      <fieldset className="field piece-edges">
                        <legend className="field-label">Polished edges</legend>
                        <div className="toggles">
                          {EDGE_SIDES.map((side) => (
                            <label key={side} className={piece.polishedEdges.includes(side) ? 'is-on' : ''}>
                              <input type="checkbox" checked={piece.polishedEdges.includes(side)} onChange={() => toggleSide(piece, side)} />
                              {SIDE_LABELS[side]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </li>
                )
              })}
            </ol>
            <button type="button" className="button button-quiet" onClick={() => setPieces((list) => [...list, newPiece()])}>
              <Icon name="plus" />
              Add a piece
            </button>
          </fieldset>

          {submitError && !Object.keys(errors).length && <ErrorNotice error={submitError} />}
          {Object.keys(errors).length > 0 && (
            <p className="field-error" role="alert">
              Check the {plural(Object.keys(errors).length, 'highlighted field')} and try again.
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Creating job' : 'Create job'}
            </button>
            <Link to="/jobs" className="button button-quiet">
              Cancel
            </Link>
          </div>
        </form>

        <aside className="intake-preview" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="section-title">
            Cutting list
          </h2>
          {!material && <p className="muted">Choose a stone to see the cutting list, slab layout and standard hours.</p>}
          {material && (
            <div className="preview-stone">
              <StoneSwatch hex={material.swatchHex} type={material.materialType} seed={material.code} className="swatch-lg" />
              <div>
                <p className="preview-stone-name">{material.name}</p>
                <p className="muted">
                  {MATERIAL_TYPE_LABELS[material.materialType]}, {material.finish}, {material.thicknessMm} mm. Slabs {fmtSize(material.slabLengthMm, material.slabWidthMm)} mm.
                </p>
              </div>
            </div>
          )}
          {material && preview && (
            <>
              {preview.oversize.length > 0 && (
                <div className="notice notice-warning" role="status">
                  <Icon name="warning" />
                  <p>
                    {preview.oversize.map((i) => `${i.label} ${i.pieceName}`).join(', ')} won't fit on one slab (usable {fmtSize(preview.usableSlab.lengthMm, preview.usableSlab.widthMm)} mm). Split
                    it into two pieces with a join.
                  </p>
                </div>
              )}
              <dl className="totals">
                <div>
                  <dt>Parts</dt>
                  <dd>{preview.totals.parts}</dd>
                </div>
                <div>
                  <dt>Area</dt>
                  <dd>{fmtM2(preview.totals.areaM2)}</dd>
                </div>
                <div>
                  <dt>Slabs</dt>
                  <dd>{preview.totals.slabsRequired}</dd>
                </div>
                <div>
                  <dt>Slab used</dt>
                  <dd>{preview.totals.yieldPct}%</dd>
                </div>
              </dl>
              <SlabLayout list={preview} stone={material} />
              <table className="table table-compact">
                <caption>Standard hours</caption>
                <tbody>
                  <tr>
                    <th scope="row">Bridge saw</th>
                    <td className="num">{fmtHours(preview.hours.saw)}</td>
                  </tr>
                  <tr>
                    <th scope="row">CNC and edge line</th>
                    <td className="num">{fmtHours(preview.hours.cnc)}</td>
                  </tr>
                  {WORK_STAGES.map((s) => (
                    <tr key={s}>
                      <th scope="row">Labour: {STAGE_LABELS[s].toLowerCase()}</th>
                      <td className="num">{fmtHours(preview.hours.labour[s])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </aside>
      </div>
    </>
  )
}
