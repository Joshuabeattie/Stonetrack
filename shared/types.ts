// The JSON shapes the API returns. The server builds these objects and the
// React app reads them, so both sides agree on field names at compile time.
// (The database uses snake_case; the API uses camelCase. See server/db/mappers.ts.)
import type {
  EdgeProfile,
  EdgeSide,
  Finish,
  MaterialType,
  OperatorTeam,
  Priority,
  RemakeReason,
  Role,
  SlabStatus,
  WorkCentre,
} from './catalog'
import type { CuttingList } from './cuttingList'
import type { IsoDate } from './dates'
import type { Stage } from './stages'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: { path: string; message: string }[]
    requestId?: string
  }
}

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: Role
}

export interface LoginResponse {
  token: string
  expiresAt: string
  user: AuthUser
}

export interface Meta {
  appName: string
  factoryName: string
  timezone: string
  environment: string
  demoMode: boolean
  demoAccounts: { username: string; password: string; role: Role }[]
}

export interface Material {
  id: number
  code: string
  name: string
  materialType: MaterialType
  finish: Finish
  thicknessMm: number
  slabLengthMm: number
  slabWidthMm: number
  reorderLevel: number
  swatchHex: string
}

export interface MaterialStock extends Material {
  available: number
  allocated: number
  consumedLast30Days: number
  lowStock: boolean
}

export interface Operator {
  id: number
  name: string
  team: OperatorTeam
}

export interface Machine {
  id: number
  code: string
  name: string
  workCentre: WorkCentre
  hoursPerDay: number
  active: boolean
}

export interface Piece {
  id: number
  pieceNo: number
  name: string
  lengthMm: number
  widthMm: number
  quantity: number
  edgeProfile: EdgeProfile
  polishedEdges: EdgeSide[]
  cutouts: number
}

export interface JobSummary {
  id: number
  jobNumber: string
  clientName: string
  materialCode: string
  materialName: string
  materialType: MaterialType
  swatchHex: string
  dueDate: IsoDate
  priority: Priority
  stage: Stage
  stageUpdatedAt: string
  createdAt: string
  dispatchedAt: string | null
  partCount: number
  areaM2: number
  remakeCount: number
  source: 'manual' | 'seed' | 'webhook'
}

export interface StageEvent {
  id: number
  eventType: 'created' | 'advanced' | 'remake'
  fromStage: Stage | null
  toStage: Stage
  labourHours: number | null
  remakeReason: RemakeReason | null
  pieceId: number | null
  pieceName: string | null
  note: string | null
  operatorName: string | null
  userName: string | null
  createdAt: string
}

export interface Slab {
  id: number
  code: string
  materialId: number
  materialCode: string
  materialName: string
  materialType: MaterialType
  swatchHex: string
  lengthMm: number
  widthMm: number
  status: SlabStatus
  rackLocation: string | null
  jobId: number | null
  jobNumber: string | null
  receivedAt: string
  allocatedAt: string | null
  consumedAt: string | null
}

export interface JobDetail extends JobSummary {
  siteAddress: string | null
  drawingRef: string
  notes: string | null
  clientEmail: string | null
  clientPhone: string | null
  externalRef: string | null
  createdByName: string | null
  shareToken: string
  material: Material
  pieces: Piece[]
  cuttingList: CuttingList
  events: StageEvent[]
  slabs: Slab[]
}

export interface KioskJob {
  id: number
  jobNumber: string
  clientName: string
  materialCode: string
  materialName: string
  materialType: MaterialType
  swatchHex: string
  dueDate: IsoDate
  priority: Priority
  stage: Stage
  stageUpdatedAt: string
  partCount: number
  pieces: { id: number; name: string; quantity: number; lengthMm: number; widthMm: number }[]
  /** Standard labour hours for the stage the job is in now (the kiosk's default). */
  standardHours: number
  slabsAllocated: number
  slabsRequired: number
}

export interface AdvanceResult {
  job: { id: number; jobNumber: string; stage: Stage }
  event: StageEvent
  allocatedSlabs: string[] // slab codes picked automatically, if any
}

export type CapacityStatus = 'late' | 'at_risk' | 'on_track'

export interface CapacityDay {
  date: IsoDate
  saw: { planned: number; capacity: number }
  cnc: { planned: number; capacity: number }
  labour: { planned: number; capacity: number }
  jobsDue: string[] // job numbers due that day
}

export interface CapacityJob {
  id: number
  jobNumber: string
  clientName: string
  stage: Stage
  priority: Priority
  dueDate: IsoDate
  projectedFinish: IsoDate | null // null = can't be finished within the planning window
  slackDays: number | null // working days between projected finish and due date
  status: CapacityStatus
  remaining: { saw: number; cnc: number; labour: number }
  workDays: IsoDate[] // days the plan works on this job
}

export interface CapacityPlan {
  today: IsoDate
  resources: { sawHoursPerDay: number; cncHoursPerDay: number; labourHoursPerDay: number; operators: number }
  days: CapacityDay[]
  jobs: CapacityJob[]
  summary: { late: number; atRisk: number; onTrack: number }
}

export interface KpiReport {
  periodDays: number
  from: string
  to: string
  throughput: { jobs: number; areaM2: number; weekly: { weekStart: IsoDate; jobs: number; areaM2: number }[] }
  leadTime: { averageDays: number | null; medianDays: number | null }
  onTime: { pct: number | null; late: number }
  remakes: { ratePct: number | null; jobsWithRemakes: number; events: number; byReason: { reason: RemakeReason; count: number }[] }
  waste: { pct: number | null; slabAreaM2: number; pieceAreaM2: number; offcutAreaM2: number }
  labour: { hours: number; m2PerHour: number | null; standardHours: number; efficiencyPct: number | null }
  wip: { stage: Stage; jobs: number }[]
}

export interface PublicJobStatus {
  jobNumber: string
  clientName: string
  materialCode: string
  materialName: string
  materialType: MaterialType
  swatchHex: string
  dueDate: IsoDate
  stage: Stage
  partCount: number
  dispatchedAt: string | null
  lastUpdated: string
  timeline: { stage: Stage; label: string; reachedAt: string | null; state: 'done' | 'current' | 'upcoming' }[]
}

export interface WebhookEventRecord {
  id: number
  receivedAt: string
  externalRef: string | null
  status: 'created' | 'duplicate' | 'rejected'
  httpStatus: number
  jobId: number | null
  jobNumber: string | null
  error: string | null
}

export interface UserRecord extends AuthUser {
  active: boolean
  createdAt: string
}
