import { describe, expect, it } from 'vitest'
import {
  SAW_KERF_MM,
  generateCuttingList,
  type MaterialSpec,
  type PieceSpec,
  type Placement,
} from '../shared/cuttingList'

const granite: MaterialSpec = { materialType: 'granite', thicknessMm: 20, slabLengthMm: 3000, slabWidthMm: 1800 }
const marble: MaterialSpec = { materialType: 'marble', thicknessMm: 20, slabLengthMm: 2800, slabWidthMm: 1700 }

const kitchen: PieceSpec[] = [
  { name: 'Main bench', lengthMm: 2850, widthMm: 650, quantity: 1, edgeProfile: 'pencil_round', polishedEdges: ['front'], cutouts: 2 },
  { name: 'Island', lengthMm: 2400, widthMm: 1000, quantity: 1, edgeProfile: 'mitred_apron', polishedEdges: ['front', 'back', 'left', 'right'], cutouts: 0 },
  { name: 'Splashback', lengthMm: 2400, widthMm: 700, quantity: 1, edgeProfile: 'arris', polishedEdges: [], cutouts: 0 },
]

function overlaps(a: Placement, b: Placement): boolean {
  return (
    a.xMm < b.xMm + b.lengthMm + SAW_KERF_MM &&
    b.xMm < a.xMm + a.lengthMm + SAW_KERF_MM &&
    a.yMm < b.yMm + b.widthMm + SAW_KERF_MM &&
    b.yMm < a.yMm + a.widthMm + SAW_KERF_MM
  )
}

describe('generateCuttingList', () => {
  it('creates one cut item per physical part, labelled by piece and copy', () => {
    const list = generateCuttingList([{ ...kitchen[0], quantity: 2 }, kitchen[2]], granite)
    expect(list.items.map((i) => i.label)).toEqual(['P1-1', 'P1-2', 'P2-1'])
    expect(list.totals.parts).toBe(3)
  })

  it('measures polished edges along the sides that are polished', () => {
    const list = generateCuttingList(kitchen, granite)
    expect(list.items[0].polishedEdgeM).toBeCloseTo(2.85) // front only
    expect(list.items[1].polishedEdgeM).toBeCloseTo(2 * 2.4 + 2 * 1.0) // all four sides
    expect(list.items[2].polishedEdgeM).toBe(0)
  })

  it('nests parts inside the usable slab area without overlapping', () => {
    const list = generateCuttingList(kitchen, granite)
    expect(list.totals.slabsRequired).toBe(2)
    expect(list.oversize).toHaveLength(0)
    for (const slab of list.slabs) {
      for (const p of slab.placements) {
        expect(p.xMm + p.lengthMm).toBeLessThanOrEqual(list.usableSlab.lengthMm)
        expect(p.yMm + p.widthMm).toBeLessThanOrEqual(list.usableSlab.widthMm)
      }
      for (let i = 0; i < slab.placements.length; i++) {
        for (let j = i + 1; j < slab.placements.length; j++) {
          expect(overlaps(slab.placements[i], slab.placements[j])).toBe(false)
        }
      }
    }
    const placedLabels = list.slabs.flatMap((s) => s.placements.map((p) => p.label)).sort()
    expect(placedLabels).toEqual(['P1-1', 'P2-1', 'P3-1'])
  })

  it('reports yield and waste from slab area versus part area', () => {
    const list = generateCuttingList(kitchen, granite)
    expect(list.totals.slabAreaM2).toBeCloseTo(2 * 3 * 1.8)
    expect(list.totals.yieldPct + list.totals.wastePct).toBeCloseTo(100)
    expect(list.totals.yieldPct).toBeCloseTo((list.totals.areaM2 / list.totals.slabAreaM2) * 100, 0)
  })

  it('never rotates veined marble, but may rotate granite', () => {
    const tall: PieceSpec = { name: 'Shelf', lengthMm: 500, widthMm: 1200, quantity: 1, edgeProfile: 'arris', polishedEdges: [], cutouts: 0 }
    const graniteList = generateCuttingList([tall], granite)
    const marbleList = generateCuttingList([tall], marble)
    expect(graniteList.slabs[0].placements[0].rotated).toBe(true)
    expect(marbleList.slabs[0].placements[0].rotated).toBe(false)
  })

  it('flags parts that are too big for one slab', () => {
    const list = generateCuttingList([{ ...kitchen[0], lengthMm: 3200 }], marble)
    expect(list.oversize.map((i) => i.label)).toEqual(['P1-1'])
    expect(list.totals.slabsRequired).toBe(0)
  })

  it('takes longer for thicker and harder stone', () => {
    const base = generateCuttingList(kitchen, granite).hours
    const thick = generateCuttingList(kitchen, { ...granite, thicknessMm: 40 }).hours
    const soft = generateCuttingList(kitchen, { ...granite, materialType: 'porcelain' }).hours
    // Cutting time doubles with thickness, but per-part setup time doesn't, so the total is a bit under 2x.
    expect(thick.saw).toBeGreaterThan(base.saw * 1.5)
    expect(thick.saw).toBeLessThan(base.saw * 2)
    expect(soft.saw).toBeLessThan(base.saw)
    expect(base.labourTotal).toBeCloseTo(Object.values(base.labour).reduce((a, b) => a + b, 0), 1)
  })
})
