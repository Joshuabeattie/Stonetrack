// The cutting layout drawn to scale. Each slab is drawn in the job's stone, the
// parts are "cut" out of it (so the veining runs through them, as on a real slab),
// and everything that isn't a part is shown washed out and hatched: that's offcut.
import { useId } from 'react'
import type { MaterialType } from '../../../shared/catalog'
import { SLAB_EDGE_MARGIN_MM, type CuttingList } from '../../../shared/cuttingList'
import { fmtSize } from '../format'
import { swatchDataUrl } from './StoneSwatch'

interface Props {
  list: CuttingList
  stone: { code: string; name: string; materialType: MaterialType; swatchHex: string; slabLengthMm: number; slabWidthMm: number }
}

export function SlabLayout({ list, stone }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (list.slabs.length === 0) {
    return <p className="muted">Add pieces to see how they lay out on {stone.name} slabs.</p>
  }
  const L = stone.slabLengthMm
  const W = stone.slabWidthMm
  const m = SLAB_EDGE_MARGIN_MM
  const labelSize = Math.round(L * 0.045) // about 135 mm on a 3 m slab
  const itemsByLabel = new Map(list.items.map((i) => [i.label, i]))
  const textureSize = { w: 300, h: Math.round((300 * W) / L) }

  return (
    <div className="slab-layouts">
      {list.slabs.map((slab) => {
        // Every slab is a little different, like real stone.
        const texture = swatchDataUrl(stone.swatchHex, stone.materialType, `${stone.code}-${slab.slabNumber}`, textureSize)
        const clipId = `cut-${uid}-${slab.slabNumber}`
        const hatchId = `hatch-${uid}-${slab.slabNumber}`
        return (
          <figure key={slab.slabNumber} className="slab-figure">
            <svg
              viewBox={`-10 -10 ${L + 20} ${W + 20}`}
              role="img"
              aria-label={`Slab ${slab.slabNumber}: ${slab.placements.map((p) => `${p.label} ${fmtSize(p.lengthMm, p.widthMm)} mm`).join(', ')}. ${slab.yieldPct}% of the slab used.`}
            >
              <defs>
                <pattern id={hatchId} width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="70" height="70" fill="rgba(255,255,255,0.78)" />
                  <line x1="0" y1="0" x2="0" y2="70" stroke="rgba(120,128,132,0.45)" strokeWidth="9" />
                </pattern>
                <clipPath id={clipId}>
                  {slab.placements.map((p) => (
                    <rect key={p.label} x={m + p.xMm} y={m + p.yMm} width={p.lengthMm} height={p.widthMm} />
                  ))}
                </clipPath>
              </defs>

              {/* The whole slab, washed out and hatched = offcut */}
              <rect x="0" y="0" width={L} height={W} fill={stone.swatchHex} />
              <image href={texture} x="0" y="0" width={L} height={W} preserveAspectRatio="none" />
              <rect x="0" y="0" width={L} height={W} fill={`url(#${hatchId})`} stroke="#8d969b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <rect x={m} y={m} width={L - 2 * m} height={W - 2 * m} fill="none" stroke="#8d969b" strokeWidth="1" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />

              {/* The parts, at full colour, cut from the same slab */}
              <g clipPath={`url(#${clipId})`}>
                <rect x="0" y="0" width={L} height={W} fill={stone.swatchHex} />
                <image href={texture} x="0" y="0" width={L} height={W} preserveAspectRatio="none" />
              </g>

              {slab.placements.map((p) => {
                const item = itemsByLabel.get(p.label)
                const x = m + p.xMm
                const y = m + p.yMm
                const showName = p.widthMm >= labelSize * 1.5 && p.lengthMm >= labelSize * 3.2
                const showSize = p.widthMm >= labelSize * 2.8 && p.lengthMm >= labelSize * 6
                const cx = x + p.lengthMm / 2
                const cy = y + p.widthMm / 2
                return (
                  <g key={p.label}>
                    <title>{`${p.label} ${item?.pieceName ?? ''}: ${fmtSize(item?.lengthMm ?? p.lengthMm, item?.widthMm ?? p.widthMm)} mm${p.rotated ? ' (turned)' : ''}`}</title>
                    <rect x={x} y={y} width={p.lengthMm} height={p.widthMm} fill="none" stroke="#1e2a32" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    {showName && (
                      <text
                        className="slab-text"
                        x={cx}
                        y={showSize ? cy - labelSize * 0.15 : cy + labelSize * 0.35}
                        fontSize={labelSize}
                        strokeWidth={labelSize * 0.16}
                        textAnchor="middle"
                      >
                        {p.label}
                      </text>
                    )}
                    {showSize && (
                      <text className="slab-text slab-text-size" x={cx} y={cy + labelSize * 0.95} fontSize={labelSize * 0.8} strokeWidth={labelSize * 0.14} textAnchor="middle">
                        {fmtSize(item?.lengthMm ?? p.lengthMm, item?.widthMm ?? p.widthMm)}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
            <figcaption>
              <strong>
                Slab {slab.slabNumber} of {list.slabs.length}
              </strong>
              <span>{fmtSize(L, W)} mm</span>
              <span>{slab.yieldPct}% used</span>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
