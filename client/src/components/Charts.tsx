// Two small, dependency-free charts built from HTML and CSS.
// Each bar is focusable and shows its exact value on hover or keyboard focus,
// and every chart can switch to a plain table.
import { useState, type CSSProperties } from 'react'

export interface Datum {
  key: string
  label: string
  value: number
  /** Full description for the tooltip and screen readers, e.g. "Week of 9 Nov: 3 jobs, 7.4 m²". */
  description: string
}

/** Rounded axis steps: 0, 2, 4… with no more than five gridlines. */
function niceScale(max: number): { top: number; ticks: number[] } {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000]
  const step = steps.find((s) => Math.ceil(max / s) <= 4) ?? Math.ceil(max / 4)
  const top = Math.max(step, Math.ceil(max / step) * step)
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

function TableView({ data, valueHeading, labelHeading }: { data: Datum[]; valueHeading: string; labelHeading: string }) {
  return (
    <table className="table table-compact">
      <thead>
        <tr>
          <th scope="col">{labelHeading}</th>
          <th scope="col" className="num">
            {valueHeading}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.key}>
            <td>{d.description.split(':')[0]}</td>
            <td className="num">{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface ChartProps {
  title: string
  subtitle?: string
  data: Datum[]
  valueHeading: string
  labelHeading: string
}

/** Vertical columns over time. Only the latest and the highest columns carry a value label. */
export function ColumnChart({ title, subtitle, data, valueHeading, labelHeading }: ChartProps) {
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(0, ...data.map((d) => d.value))
  const { top, ticks } = niceScale(Math.max(1, max))
  const labelled = new Set([data[data.length - 1]?.key, data.find((d) => d.value === max)?.key])

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="link-button" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </figcaption>
      {asTable ? (
        <TableView data={data} valueHeading={valueHeading} labelHeading={labelHeading} />
      ) : (
        <div className="columns">
          <div className="columns-plot">
            {ticks.map((t) => (
              <span key={t} className="gridline" style={{ bottom: `${(t / top) * 100}%` }}>
                <span className="tick">{t}</span>
              </span>
            ))}
            {data.map((d) => (
              <div key={d.key} className="column" tabIndex={0} aria-label={d.description}>
                <span className="column-bar" style={{ height: `${(d.value / top) * 100}%` }}>
                  {labelled.has(d.key) && d.value > 0 && <span className="column-value">{d.value}</span>}
                </span>
                <span className="tooltip" role="tooltip">
                  {d.description}
                </span>
              </div>
            ))}
          </div>
          <div className="columns-axis" aria-hidden="true">
            {data.map((d) => (
              <span key={d.key}>{d.label}</span>
            ))}
          </div>
        </div>
      )}
    </figure>
  )
}

/** Horizontal bars for a ranked list of categories, value at the tip of each bar. */
export function BarList({ title, subtitle, data, valueHeading, labelHeading, empty }: ChartProps & { empty: string }) {
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {data.length > 0 && (
          <button type="button" className="link-button" onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </figcaption>
      {data.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : asTable ? (
        <TableView data={data} valueHeading={valueHeading} labelHeading={labelHeading} />
      ) : (
        <ul className="barlist">
          {data.map((d) => (
            <li key={d.key} tabIndex={0} aria-label={d.description}>
              <span className="barlist-label">{d.label}</span>
              <span className="barlist-track">
                <span className="barlist-bar" style={{ '--w': `${(d.value / max) * 100}%` } as CSSProperties} />
                <span className="barlist-value">{d.value}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
