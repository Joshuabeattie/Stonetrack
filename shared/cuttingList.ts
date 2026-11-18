// Turns the pieces on a job into a cutting list, a slab layout and standard hours.
//
// It is a pure function (no database, no network), so the server and the React
// intake form run exactly the same code: what you preview is what gets saved.
// Nothing it produces is stored; it is recalculated from the pieces when needed.
import {
  EDGE_PROFILE_LABELS,
  type EdgeProfile,
  type EdgeSide,
  type MaterialType,
} from './catalog'
import type { WorkStage } from './stages'

export interface PieceSpec {
  name: string
  lengthMm: number
  widthMm: number
  quantity: number
  edgeProfile: EdgeProfile
  polishedEdges: EdgeSide[]
  cutouts: number
}

export interface MaterialSpec {
  materialType: MaterialType
  thicknessMm: number
  slabLengthMm: number
  slabWidthMm: number
}

/** Rough edge trimmed off every side of a slab before parts are cut (mm). */
export const SLAB_EDGE_MARGIN_MM = 20
/** Gap left between parts for the saw blade (mm). */
export const SAW_KERF_MM = 5

/**
 * Standard times used for scheduling. They are illustrative numbers for the demo,
 * kept in one place so they are easy to explain and to tune.
 */
export const STANDARD_TIMES = {
  sawMinutesPerMetre: 6, // bridge saw, 20 mm stone, including loading and handling
  sawSetupMinutesPerPart: 10,
  cncMinutesPerPolishedMetre: 8, // edge profiling and polishing on the CNC / edge line
  cncMinutesPerCutout: 30, // sink, cooktop or tap-hole cutout
  cncSetupMinutesPerPart: 10,
  handFinishMinutesPerPart: 20, // hand polishing, sealing
  allocationHoursPerJob: 0.25,
  allocationHoursPerSlab: 0.1,
  cutHandlingMinutesPerPart: 5,
  qcHoursPerJob: 0.5,
  qcMinutesPerPart: 5,
  dispatchHoursPerJob: 0.75,
  dispatchMinutesPerPart: 10,
} as const

/**
 * hardness: slows sawing and polishing (granite and quartzite are hard, limestone soft).
 * allowRotation: veined natural stone keeps the vein running along the slab, so parts aren't turned.
 */
export const MATERIAL_FACTORS: Record<MaterialType, { hardness: number; allowRotation: boolean }> = {
  granite: { hardness: 1.25, allowRotation: true },
  marble: { hardness: 0.9, allowRotation: false },
  quartzite: { hardness: 1.5, allowRotation: false },
  porcelain: { hardness: 1.1, allowRotation: true },
  sintered: { hardness: 1.3, allowRotation: true },
  limestone: { hardness: 0.8, allowRotation: false },
}

/** How long a profile takes relative to a simple pencil-round edge. */
export const EDGE_PROFILE_FACTORS: Record<EdgeProfile, number> = {
  pencil_round: 1,
  arris: 0.8,
  bullnose: 1.5,
  ogee: 2,
  mitred_apron: 2.5,
}

export interface CutItem {
  label: string // "P2-1" = piece 2, copy 1
  pieceIndex: number // position of the piece in the job (0-based)
  pieceName: string
  lengthMm: number
  widthMm: number
  areaM2: number
  polishedEdgeM: number
  edgeProfile: EdgeProfile
  edgeProfileLabel: string
  cutouts: number
}

export interface Placement {
  label: string
  xMm: number // from the left of the usable area
  yMm: number // from the top of the usable area
  lengthMm: number // size as laid on the slab
  widthMm: number
  rotated: boolean
}

export interface SlabPlan {
  slabNumber: number
  placements: Placement[]
  usedAreaM2: number
  yieldPct: number
}

export interface StandardHours {
  saw: number // machine hours on the bridge saw
  cnc: number // machine hours on the CNC / edge line
  labour: Record<WorkStage, number>
  labourTotal: number
}

export interface CuttingList {
  items: CutItem[]
  oversize: CutItem[] // parts too big for one slab (they need a join)
  slabs: SlabPlan[]
  usableSlab: { lengthMm: number; widthMm: number }
  totals: {
    parts: number
    areaM2: number
    polishedEdgeM: number
    cutouts: number
    slabsRequired: number
    slabAreaM2: number
    yieldPct: number
    wastePct: number
  }
  hours: StandardHours
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

function polishedEdgeMetres(piece: PieceSpec): number {
  let mm = 0
  for (const side of piece.polishedEdges) {
    mm += side === 'front' || side === 'back' ? piece.lengthMm : piece.widthMm
  }
  return mm / 1000
}

/** One cut item per physical part: a piece with quantity 2 becomes two items. */
export function expandPieces(pieces: PieceSpec[]): CutItem[] {
  const items: CutItem[] = []
  pieces.forEach((piece, pieceIndex) => {
    for (let copy = 1; copy <= piece.quantity; copy++) {
      items.push({
        label: `P${pieceIndex + 1}-${copy}`,
        pieceIndex,
        pieceName: piece.name,
        lengthMm: piece.lengthMm,
        widthMm: piece.widthMm,
        areaM2: (piece.lengthMm * piece.widthMm) / 1_000_000,
        polishedEdgeM: polishedEdgeMetres(piece),
        edgeProfile: piece.edgeProfile,
        edgeProfileLabel: EDGE_PROFILE_LABELS[piece.edgeProfile],
        cutouts: piece.cutouts,
      })
    }
  })
  return items
}

/**
 * Lays parts out on slabs with a simple "shelf" method (first-fit decreasing height):
 *  1. Sort parts tallest first.
 *  2. Put each part on the first shelf (row) with room for it, on the first slab with room.
 *  3. If no shelf fits, start a new shelf under the last one; if the slab is full, start a new slab.
 * It is not optimal (real nesting software does better), but it is fast, predictable and easy to explain.
 */
export function nestOnSlabs(items: CutItem[], material: MaterialSpec) {
  const usableL = material.slabLengthMm - 2 * SLAB_EDGE_MARGIN_MM
  const usableW = material.slabWidthMm - 2 * SLAB_EDGE_MARGIN_MM
  const canRotate = MATERIAL_FACTORS[material.materialType].allowRotation

  type Part = { item: CutItem; l: number; w: number; rotated: boolean }
  const parts: Part[] = []
  const oversize: CutItem[] = []

  for (const item of items) {
    let best: Part | null = null
    if (item.lengthMm <= usableL && item.widthMm <= usableW) {
      best = { item, l: item.lengthMm, w: item.widthMm, rotated: false }
    }
    if (canRotate && item.widthMm <= usableL && item.lengthMm <= usableW) {
      const turned: Part = { item, l: item.widthMm, w: item.lengthMm, rotated: true }
      // Prefer the orientation with the lower shelf height: it wastes less of the slab.
      if (!best || turned.w < best.w) best = turned
    }
    if (best) parts.push(best)
    else oversize.push(item)
  }

  parts.sort((a, b) => b.w - a.w || b.l - a.l)

  interface Shelf {
    y: number
    height: number
    used: number // length used so far along the shelf
  }
  interface OpenSlab {
    shelves: Shelf[]
    usedHeight: number
    placements: Placement[]
  }
  const slabs: OpenSlab[] = []
  const place = (slab: OpenSlab, part: Part, x: number, y: number) => {
    slab.placements.push({ label: part.item.label, xMm: x, yMm: y, lengthMm: part.l, widthMm: part.w, rotated: part.rotated })
  }

  for (const part of parts) {
    let placed = false
    for (const slab of slabs) {
      for (const shelf of slab.shelves) {
        const x = shelf.used + SAW_KERF_MM
        if (part.w <= shelf.height && x + part.l <= usableL) {
          place(slab, part, x, shelf.y)
          shelf.used = x + part.l
          placed = true
          break
        }
      }
      if (placed) break
      const y = slab.usedHeight + SAW_KERF_MM
      if (y + part.w <= usableW) {
        slab.shelves.push({ y, height: part.w, used: part.l })
        slab.usedHeight = y + part.w
        place(slab, part, 0, y)
        placed = true
        break
      }
    }
    if (!placed) {
      const slab: OpenSlab = { shelves: [{ y: 0, height: part.w, used: part.l }], usedHeight: part.w, placements: [] }
      place(slab, part, 0, 0)
      slabs.push(slab)
    }
  }

  const slabAreaM2 = (material.slabLengthMm * material.slabWidthMm) / 1_000_000
  const plans: SlabPlan[] = slabs.map((slab, i) => {
    const usedAreaM2 = slab.placements.reduce((sum, p) => sum + (p.lengthMm * p.widthMm) / 1_000_000, 0)
    return {
      slabNumber: i + 1,
      placements: slab.placements,
      usedAreaM2: round2(usedAreaM2),
      yieldPct: round1((usedAreaM2 / slabAreaM2) * 100),
    }
  })

  return { slabs: plans, oversize, usableSlab: { lengthMm: usableL, widthMm: usableW } }
}

/** Standard machine and labour hours for each stage of the job. */
export function standardHours(items: CutItem[], material: MaterialSpec, slabsRequired: number): StandardHours {
  const T = STANDARD_TIMES
  const hardness = MATERIAL_FACTORS[material.materialType].hardness
  const thickness = material.thicknessMm / 20 // relative to standard 20 mm stone

  let sawMinutes = 0
  let cncMinutes = 0
  for (const item of items) {
    const perimeterM = (2 * (item.lengthMm + item.widthMm)) / 1000
    sawMinutes += perimeterM * T.sawMinutesPerMetre * hardness * thickness + T.sawSetupMinutesPerPart

    const edgeMinutes = item.polishedEdgeM * T.cncMinutesPerPolishedMetre * EDGE_PROFILE_FACTORS[item.edgeProfile] * hardness * thickness
    const cutoutMinutes = item.cutouts * T.cncMinutesPerCutout * hardness * thickness
    if (edgeMinutes + cutoutMinutes > 0) cncMinutes += edgeMinutes + cutoutMinutes + T.cncSetupMinutesPerPart
  }

  const parts = items.length
  const saw = sawMinutes / 60
  const cnc = cncMinutes / 60
  const labour: Record<WorkStage, number> = {
    slab_allocation: round2(T.allocationHoursPerJob + slabsRequired * T.allocationHoursPerSlab),
    cutting: round2(saw + (parts * T.cutHandlingMinutesPerPart) / 60), // operator stays with the saw
    finishing: round2(cnc + (parts * T.handFinishMinutesPerPart) / 60), // an operator attends the CNC, then hand-finishes
    quality_check: round2(T.qcHoursPerJob + (parts * T.qcMinutesPerPart) / 60),
    dispatch: round2(T.dispatchHoursPerJob + (parts * T.dispatchMinutesPerPart) / 60),
  }
  const labourTotal = round2(Object.values(labour).reduce((a, b) => a + b, 0))
  return { saw: round2(saw), cnc: round2(cnc), labour, labourTotal }
}

export function generateCuttingList(pieces: PieceSpec[], material: MaterialSpec): CuttingList {
  const items = expandPieces(pieces)
  const { slabs, oversize, usableSlab } = nestOnSlabs(items, material)

  const areaM2 = items.reduce((sum, i) => sum + i.areaM2, 0)
  const slabAreaM2 = slabs.length * ((material.slabLengthMm * material.slabWidthMm) / 1_000_000)
  const nestedAreaM2 = slabs.reduce((sum, s) => sum + s.usedAreaM2, 0)
  const yieldPct = slabAreaM2 > 0 ? round1((nestedAreaM2 / slabAreaM2) * 100) : 0

  return {
    items,
    oversize,
    slabs,
    usableSlab,
    totals: {
      parts: items.length,
      areaM2: round2(areaM2),
      polishedEdgeM: round2(items.reduce((sum, i) => sum + i.polishedEdgeM, 0)),
      cutouts: items.reduce((sum, i) => sum + i.cutouts, 0),
      slabsRequired: slabs.length,
      slabAreaM2: round2(slabAreaM2),
      yieldPct,
      wastePct: slabAreaM2 > 0 ? round1(100 - yieldPct) : 0,
    },
    hours: standardHours(items, material, slabs.length),
  }
}

/** The remaining work for each stage, as used by the capacity planner. */
export interface StageWork {
  stage: WorkStage
  saw: number
  cnc: number
  labour: number
}

export function stageWorkFromHours(hours: StandardHours): StageWork[] {
  return [
    { stage: 'slab_allocation', saw: 0, cnc: 0, labour: hours.labour.slab_allocation },
    { stage: 'cutting', saw: hours.saw, cnc: 0, labour: hours.labour.cutting },
    { stage: 'finishing', saw: 0, cnc: hours.cnc, labour: hours.labour.finishing },
    { stage: 'quality_check', saw: 0, cnc: 0, labour: hours.labour.quality_check },
    { stage: 'dispatch', saw: 0, cnc: 0, labour: hours.labour.dispatch },
  ]
}
