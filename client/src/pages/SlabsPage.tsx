import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { MATERIAL_TYPE_LABELS } from '../../../shared/catalog'
import type { MaterialStock, Slab } from '../../../shared/types'
import { api, ApiError } from '../api'
import { Empty, ErrorNotice, Loading } from '../components/Feedback'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { Modal } from '../components/Modal'
import { StoneSwatch } from '../components/StoneSwatch'
import { useToast } from '../components/Toast'
import { fmtSize, formatDateTime, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const STATUS_LABELS = { available: 'In stock', allocated: 'Allocated', consumed: 'Cut' } as const

/** One small slab shape per available slab, like slabs standing in a rack. */
function Rack({ stone }: { stone: MaterialStock }) {
  const shown = Math.min(stone.available, 10)
  return (
    <span className="rack" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <StoneSwatch key={i} hex={stone.swatchHex} type={stone.materialType} seed={stone.code} className="rack-slab" />
      ))}
      {stone.available > shown && <span className="rack-more">+{stone.available - shown}</span>}
      {stone.available === 0 && <span className="rack-empty" />}
    </span>
  )
}

export function SlabsPage() {
  useDocumentTitle('Slabs and stock')
  const toast = useToast()
  const stock = useApi<MaterialStock[]>('/slabs/stock')
  const [status, setStatus] = useState('available')
  const [materialId, setMaterialId] = useState('')
  const query = new URLSearchParams({ ...(status && { status }), ...(materialId && { materialId }) }).toString()
  const slabs = useApi<Slab[]>(`/slabs?${query}`)
  const [receiving, setReceiving] = useState<number | null | 'any'>(null)
  const [error, setError] = useState<ApiError | null>(null)

  const refresh = () => {
    stock.reload()
    slabs.reload()
  }

  async function release(slab: Slab) {
    setError(null)
    try {
      await api(`/slabs/${slab.id}/release`, { method: 'POST' })
      toast(`${slab.code} returned to stock`)
      refresh()
    } catch (err) {
      setError(err as ApiError)
    }
  }

  const low = stock.data?.filter((s) => s.lowStock) ?? []

  return (
    <>
      <PageHeader title="Slabs and stock" sub={low.length ? `${plural(low.length, 'stone')} at or below reorder level` : 'Every stone is above its reorder level'}>
        <button type="button" className="button button-primary" onClick={() => setReceiving('any')}>
          <Icon name="plus" />
          Receive slabs
        </button>
      </PageHeader>

      {stock.error && <ErrorNotice error={stock.error} onRetry={stock.reload} />}
      {!stock.data && stock.loading && <Loading />}
      {stock.data && (
        <section className="section" aria-labelledby="stock-heading">
          <h2 id="stock-heading" className="section-title">
            Stock by stone
          </h2>
          <ul className={`stock ${stock.loading ? 'is-refreshing' : ''}`}>
            {stock.data.map((stone) => (
              <li key={stone.id} className={`stock-row ${stone.lowStock ? 'is-low' : ''}`}>
                <StoneSwatch hex={stone.swatchHex} type={stone.materialType} seed={stone.code} className="swatch-lg" />
                <div className="stock-name">
                  <p>
                    <strong>{stone.name}</strong> <span className="code">{stone.code}</span>
                  </p>
                  <p className="muted">
                    {MATERIAL_TYPE_LABELS[stone.materialType]}, {stone.finish}, {stone.thicknessMm} mm, {fmtSize(stone.slabLengthMm, stone.slabWidthMm)} mm slabs
                  </p>
                </div>
                <Rack stone={stone} />
                <dl className="stock-numbers">
                  <div>
                    <dt>In stock</dt>
                    <dd>{stone.available}</dd>
                  </div>
                  <div>
                    <dt>Allocated</dt>
                    <dd>{stone.allocated}</dd>
                  </div>
                  <div>
                    <dt>Cut, 30 days</dt>
                    <dd>{stone.consumedLast30Days}</dd>
                  </div>
                  <div>
                    <dt>Reorder at</dt>
                    <dd>{stone.reorderLevel}</dd>
                  </div>
                </dl>
                <div className="stock-action">
                  {stone.lowStock && (
                    <span className="status status-at_risk">
                      <Icon name="warning" size={15} />
                      Low stock
                    </span>
                  )}
                  <button type="button" className="link-button" onClick={() => setReceiving(stone.id)}>
                    Receive
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="slab-list-heading">
        <h2 id="slab-list-heading" className="section-title">
          Slabs
        </h2>
        <div className="filters">
          <div className="segmented" role="radiogroup" aria-label="Status">
            {(['available', 'allocated', 'consumed', ''] as const).map((s) => (
              <label key={s || 'all'} className={status === s ? 'is-selected' : ''}>
                <input type="radio" name="slab-status" checked={status === s} onChange={() => setStatus(s)} />
                {s ? STATUS_LABELS[s] : 'All'}
              </label>
            ))}
          </div>
          <label className="filter">
            <span className="visually-hidden">Stone</span>
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Every stone</option>
              {stock.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <ErrorNotice error={error} />}
        {slabs.error && <ErrorNotice error={slabs.error} onRetry={slabs.reload} />}
        {slabs.data && slabs.data.length === 0 && <Empty title="No slabs match these filters" />}
        {slabs.data && slabs.data.length > 0 && (
          <div className={`table-wrap ${slabs.loading ? 'is-refreshing' : ''}`}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Slab</th>
                  <th scope="col">Stone</th>
                  <th scope="col" className="num">
                    Size (mm)
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Rack</th>
                  <th scope="col">Job</th>
                  <th scope="col">Received</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slabs.data.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Slab" className="code">
                      {s.code}
                    </td>
                    <td data-label="Stone">
                      <span className="stone-chip">
                        <StoneSwatch hex={s.swatchHex} type={s.materialType} seed={s.materialCode} />
                        {s.materialName}
                      </span>
                    </td>
                    <td data-label="Size" className="num">
                      {fmtSize(s.lengthMm, s.widthMm)}
                    </td>
                    <td data-label="Status">{STATUS_LABELS[s.status]}</td>
                    <td data-label="Rack">{s.rackLocation ?? ''}</td>
                    <td data-label="Job">{s.jobId ? <Link to={`/jobs/${s.jobId}`}>{s.jobNumber}</Link> : ''}</td>
                    <td data-label="Received">{formatDateTime(s.receivedAt)}</td>
                    <td>
                      {s.status === 'allocated' && (
                        <button type="button" className="link-button" onClick={() => void release(s)}>
                          Return to stock
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={receiving !== null} title="Receive slabs" onClose={() => setReceiving(null)}>
        {stock.data && receiving !== null && (
          <ReceiveForm
            stones={stock.data}
            initialMaterialId={receiving === 'any' ? '' : String(receiving)}
            onDone={(slabsReceived) => {
              setReceiving(null)
              const first = slabsReceived[0]
              const last = slabsReceived[slabsReceived.length - 1]
              toast(`Received ${plural(slabsReceived.length, 'slab')} of ${first.materialName}: ${first.code}${slabsReceived.length > 1 ? ` to ${last.code}` : ''}`)
              refresh()
            }}
          />
        )}
      </Modal>
    </>
  )
}

function ReceiveForm({ stones, initialMaterialId, onDone }: { stones: MaterialStock[]; initialMaterialId: string; onDone: (slabs: Slab[]) => void }) {
  const [materialId, setMaterialId] = useState(initialMaterialId)
  const [quantity, setQuantity] = useState('1')
  const [rackLocation, setRackLocation] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await api<Slab[]>('/slabs', { method: 'POST', body: { materialId: materialId || 0, quantity, rackLocation } }))
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  const fieldErrors = error?.fieldErrors?.() ?? {}
  const stone = stones.find((s) => s.id === Number(materialId))
  return (
    <form onSubmit={submit} className="form-grid">
      <Field label="Stone" error={fieldErrors.materialId} className="span-2">
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Choose a stone</option>
          {stones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Number of slabs" error={fieldErrors.quantity}>
        <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label="Rack (optional)" error={fieldErrors.rackLocation} hint="For example B4">
        <input value={rackLocation} onChange={(e) => setRackLocation(e.target.value)} maxLength={12} />
      </Field>
      {stone && <p className="muted span-2">Booked in at the standard size for {stone.name}: {fmtSize(stone.slabLengthMm, stone.slabWidthMm)} mm.</p>}
      {error && !Object.keys(fieldErrors).length && <ErrorNotice error={error} />}
      <div className="form-actions span-2">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Receiving' : 'Receive slabs'}
        </button>
      </div>
    </form>
  )
}
