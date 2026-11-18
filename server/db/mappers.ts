// Row shapes as they come out of PostgreSQL (snake_case), and functions that turn
// them into the API's camelCase objects (shared/types.ts). Keeping the conversion
// here means SQL can follow database conventions and JSON can follow JavaScript ones.
import type {
  EdgeProfile,
  EdgeSide,
  Finish,
  MaterialType,
  OperatorTeam,
  Priority,
  RemakeReason,
  SlabStatus,
  WorkCentre,
} from '../../shared/catalog'
import type { MaterialSpec } from '../../shared/cuttingList'
import type { Stage } from '../../shared/stages'
import type { JobSummary, Machine, Material, Operator, Piece, Slab, StageEvent } from '../../shared/types'

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value)
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value))

export interface MaterialRow {
  id: number
  code: string
  name: string
  material_type: MaterialType
  finish: Finish
  thickness_mm: number
  slab_length_mm: number
  slab_width_mm: number
  reorder_level: number
  swatch_hex: string
}

export const MATERIAL_COLUMNS =
  'm.id, m.code, m.name, m.material_type, m.finish, m.thickness_mm, m.slab_length_mm, m.slab_width_mm, m.reorder_level, m.swatch_hex'

export function toMaterial(r: MaterialRow): Material {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    materialType: r.material_type,
    finish: r.finish,
    thicknessMm: r.thickness_mm,
    slabLengthMm: r.slab_length_mm,
    slabWidthMm: r.slab_width_mm,
    reorderLevel: r.reorder_level,
    swatchHex: r.swatch_hex,
  }
}

export function toMaterialSpec(m: Material): MaterialSpec {
  return { materialType: m.materialType, thicknessMm: m.thicknessMm, slabLengthMm: m.slabLengthMm, slabWidthMm: m.slabWidthMm }
}

export interface OperatorRow {
  id: number
  name: string
  team: OperatorTeam
}
export const toOperator = (r: OperatorRow): Operator => ({ id: r.id, name: r.name, team: r.team })

export interface MachineRow {
  id: number
  code: string
  name: string
  work_centre: WorkCentre
  hours_per_day: number
  active: boolean
}
export const toMachine = (r: MachineRow): Machine => ({
  id: r.id,
  code: r.code,
  name: r.name,
  workCentre: r.work_centre,
  hoursPerDay: r.hours_per_day,
  active: r.active,
})

/** The columns and joins behind every job list. Add WHERE / ORDER BY after it. */
export const JOB_SUMMARY_SQL = `
  SELECT j.id, j.job_number, c.name AS client_name,
         m.code AS material_code, m.name AS material_name, m.material_type, m.swatch_hex,
         j.due_date, j.priority, j.current_stage, j.stage_updated_at, j.created_at, j.dispatched_at, j.source,
         COALESCE(p.part_count, 0) AS part_count,
         COALESCE(p.area_m2, 0) AS area_m2,
         COALESCE(r.remake_count, 0) AS remake_count
    FROM jobs j
    JOIN clients c ON c.id = j.client_id
    JOIN materials m ON m.id = j.material_id
    LEFT JOIN LATERAL (
      SELECT sum(quantity)::int AS part_count,
             round(sum(length_mm::numeric * width_mm * quantity) / 1000000, 2) AS area_m2
        FROM job_pieces WHERE job_id = j.id
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS remake_count FROM stage_events WHERE job_id = j.id AND event_type = 'remake'
    ) r ON true`

export interface JobSummaryRow {
  id: number
  job_number: string
  client_name: string
  material_code: string
  material_name: string
  material_type: MaterialType
  swatch_hex: string
  due_date: string
  priority: Priority
  current_stage: Stage
  stage_updated_at: Date
  created_at: Date
  dispatched_at: Date | null
  source: JobSummary['source']
  part_count: number
  area_m2: number
  remake_count: number
}

export function toJobSummary(r: JobSummaryRow): JobSummary {
  return {
    id: r.id,
    jobNumber: r.job_number,
    clientName: r.client_name,
    materialCode: r.material_code,
    materialName: r.material_name,
    materialType: r.material_type,
    swatchHex: r.swatch_hex,
    dueDate: r.due_date,
    priority: r.priority,
    stage: r.current_stage,
    stageUpdatedAt: iso(r.stage_updated_at),
    createdAt: iso(r.created_at),
    dispatchedAt: isoOrNull(r.dispatched_at),
    partCount: r.part_count,
    areaM2: r.area_m2,
    remakeCount: r.remake_count,
    source: r.source,
  }
}

export interface PieceRow {
  id: number
  piece_no: number
  name: string
  length_mm: number
  width_mm: number
  quantity: number
  edge_profile: EdgeProfile
  polished_edges: EdgeSide[]
  cutouts: number
}

export const toPiece = (r: PieceRow): Piece => ({
  id: r.id,
  pieceNo: r.piece_no,
  name: r.name,
  lengthMm: r.length_mm,
  widthMm: r.width_mm,
  quantity: r.quantity,
  edgeProfile: r.edge_profile,
  polishedEdges: r.polished_edges,
  cutouts: r.cutouts,
})

export const STAGE_EVENT_SQL = `
  SELECT e.id, e.job_id, e.event_type, e.from_stage, e.to_stage, e.labour_hours, e.remake_reason,
         e.piece_id, p.name AS piece_name, e.note, o.name AS operator_name, u.display_name AS user_name, e.created_at
    FROM stage_events e
    LEFT JOIN job_pieces p ON p.id = e.piece_id
    LEFT JOIN operators o ON o.id = e.operator_id
    LEFT JOIN users u ON u.id = e.user_id`

export interface StageEventRow {
  id: number
  job_id: number
  event_type: StageEvent['eventType']
  from_stage: Stage | null
  to_stage: Stage
  labour_hours: number | null
  remake_reason: RemakeReason | null
  piece_id: number | null
  piece_name: string | null
  note: string | null
  operator_name: string | null
  user_name: string | null
  created_at: Date
}

export const toStageEvent = (r: StageEventRow): StageEvent => ({
  id: r.id,
  eventType: r.event_type,
  fromStage: r.from_stage,
  toStage: r.to_stage,
  labourHours: r.labour_hours,
  remakeReason: r.remake_reason,
  pieceId: r.piece_id,
  pieceName: r.piece_name,
  note: r.note,
  operatorName: r.operator_name,
  userName: r.user_name,
  createdAt: iso(r.created_at),
})

export const SLAB_SQL = `
  SELECT s.id, s.code, s.material_id, m.code AS material_code, m.name AS material_name, m.material_type, m.swatch_hex,
         s.length_mm, s.width_mm, s.status, s.rack_location, s.job_id, j.job_number,
         s.received_at, s.allocated_at, s.consumed_at
    FROM slabs s
    JOIN materials m ON m.id = s.material_id
    LEFT JOIN jobs j ON j.id = s.job_id`

export interface SlabRow {
  id: number
  code: string
  material_id: number
  material_code: string
  material_name: string
  material_type: MaterialType
  swatch_hex: string
  length_mm: number
  width_mm: number
  status: SlabStatus
  rack_location: string | null
  job_id: number | null
  job_number: string | null
  received_at: Date
  allocated_at: Date | null
  consumed_at: Date | null
}

export const toSlab = (r: SlabRow): Slab => ({
  id: r.id,
  code: r.code,
  materialId: r.material_id,
  materialCode: r.material_code,
  materialName: r.material_name,
  materialType: r.material_type,
  swatchHex: r.swatch_hex,
  lengthMm: r.length_mm,
  widthMm: r.width_mm,
  status: r.status,
  rackLocation: r.rack_location,
  jobId: r.job_id,
  jobNumber: r.job_number,
  receivedAt: iso(r.received_at),
  allocatedAt: isoOrNull(r.allocated_at),
  consumedAt: isoOrNull(r.consumed_at),
})
