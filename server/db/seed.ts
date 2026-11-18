// Demo data: ~40 realistic, entirely fictional jobs with consistent history.
//
// The data is generated from a fixed random seed, so every run produces the same
// jobs, and dates are relative to "today" in the factory time zone, so the demo
// always looks current (some jobs dispatched over the last two months, others on
// the floor right now, a few running late).
//
// All business names, people, phone numbers (03 5550 xxxx is a range reserved for
// fiction) and addresses (.example domains, made-up suburbs) are invented.
import type pg from 'pg'
import type { EdgeProfile, EdgeSide, MaterialType, OperatorTeam, RemakeReason, Role } from '../../shared/catalog'
import { generateCuttingList, type PieceSpec } from '../../shared/cuttingList'
import { addDays, addWorkingDays, todayInZone, workingDaysBetween, zonedTimeToUtc, type IsoDate } from '../../shared/dates'
import { nextStage, type Stage, type WorkStage } from '../../shared/stages'
import { hashPassword } from '../auth/passwords'
import { config } from '../config'
import { insertRows } from './insert'

export const DEMO_ACCOUNTS: { username: string; password: string; role: Role }[] = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'manager', password: 'manager123', role: 'manager' },
  { username: 'kiosk', password: 'kiosk123', role: 'kiosk' },
]

const USERS = [
  { username: 'admin', displayName: 'Alex Morgan', role: 'admin' },
  { username: 'manager', displayName: 'Jordan Lee', role: 'manager' },
  { username: 'kiosk', displayName: 'Floor kiosk', role: 'kiosk' },
] as const

const OPERATORS: { name: string; team: OperatorTeam }[] = [
  { name: 'Ari K.', team: 'yard' },
  { name: 'Mateo R.', team: 'saw' },
  { name: 'Linh N.', team: 'cnc' },
  { name: 'Sione F.', team: 'cnc' },
  { name: 'Ellie B.', team: 'finishing' },
  { name: 'Grace M.', team: 'qc' },
  { name: 'Dev P.', team: 'dispatch' },
]

const MACHINES = [
  { code: 'SAW-1', name: 'Bridge saw', workCentre: 'saw', hoursPerDay: 7.6 },
  { code: 'CNC-1', name: 'CNC router', workCentre: 'cnc', hoursPerDay: 7.6 },
  { code: 'EDGE-1', name: 'Edge polisher (half shift)', workCentre: 'cnc', hoursPerDay: 3.8 },
] as const

interface SeedMaterial {
  code: string
  name: string
  type: MaterialType
  finish: 'polished' | 'honed' | 'leathered' | 'matt'
  thickness: number
  length: number
  width: number
  reorder: number
  swatch: string
  inStock: number // available slabs in the yard after the seed
}

const MATERIALS: SeedMaterial[] = [
  { code: 'GRA-IRB', name: 'Ironbark Grey', type: 'granite', finish: 'polished', thickness: 20, length: 3000, width: 1800, reorder: 3, swatch: '#6b6e70', inStock: 7 },
  { code: 'GRA-NGT', name: 'Night Basin', type: 'granite', finish: 'leathered', thickness: 30, length: 3000, width: 1800, reorder: 2, swatch: '#2b2c2e', inStock: 0 },
  { code: 'GRA-WTL', name: 'Wattle Gold', type: 'granite', finish: 'polished', thickness: 20, length: 3000, width: 1700, reorder: 2, swatch: '#b59a68', inStock: 3 },
  { code: 'MAR-SNG', name: 'Snowgum White', type: 'marble', finish: 'polished', thickness: 20, length: 2800, width: 1700, reorder: 2, swatch: '#ebe8e2', inStock: 4 },
  { code: 'MAR-CLD', name: 'Cloudline Vein', type: 'marble', finish: 'honed', thickness: 20, length: 2800, width: 1700, reorder: 2, swatch: '#d8d3ca', inStock: 2 },
  { code: 'QTZ-TDW', name: 'Tidewater Taupe', type: 'quartzite', finish: 'leathered', thickness: 20, length: 3000, width: 1800, reorder: 2, swatch: '#a59b8f', inStock: 3 },
  { code: 'POR-ASH', name: 'Ashfall Concrete', type: 'porcelain', finish: 'matt', thickness: 12, length: 3200, width: 1600, reorder: 3, swatch: '#8e8b86', inStock: 9 },
  { code: 'POR-SLT', name: 'Saltbush Vein', type: 'porcelain', finish: 'polished', thickness: 12, length: 3200, width: 1600, reorder: 3, swatch: '#f2f0eb', inStock: 6 },
  { code: 'SIN-BSH', name: 'Basalt Shadow', type: 'sintered', finish: 'matt', thickness: 20, length: 3200, width: 1600, reorder: 2, swatch: '#3d3c39', inStock: 4 },
  { code: 'LIM-SHC', name: 'Shell Coast', type: 'limestone', finish: 'honed', thickness: 30, length: 2800, width: 1600, reorder: 1, swatch: '#d9ccb2', inStock: 1 },
]

const CLIENTS = [
  { name: 'Fernhollow Kitchens', email: 'orders@fernhollow.example', phone: '03 5550 0101' },
  { name: 'Cobaltline Joinery', email: 'jobs@cobaltline.example', phone: '03 5550 0102' },
  { name: 'Tallowwood & Tide Renovations', email: 'hello@tallowwoodtide.example', phone: '03 5550 0103' },
  { name: 'Glasshouse Lane Homes', email: 'site@glasshouselane.example', phone: '03 5550 0104' },
  { name: 'Kingfisher Bend Cabinetry', email: 'office@kingfisherbend.example', phone: '03 5550 0105' },
  { name: 'Bramblewick Interiors', email: 'studio@bramblewick.example', phone: '03 5550 0106' },
  { name: 'Northpoint Ridge Developments', email: 'procurement@northpointridge.example', phone: '03 5550 0107' },
  { name: 'Saltpan Bathrooms', email: 'orders@saltpan.example', phone: '03 5550 0108' },
  { name: 'Quoll Creek Builders', email: 'admin@quollcreek.example', phone: '03 5550 0109' },
  { name: 'Larkspur Lane Kitchens', email: 'design@larkspurlane.example', phone: '03 5550 0110' },
  { name: 'M. & J. Okafor', email: 'okafor.home@mail.example', phone: '03 5550 0111' },
  { name: 'Priya Hendry', email: 'p.hendry@mail.example', phone: '03 5550 0112' },
  { name: 'The Castellano family', email: 'castellano@mail.example', phone: '03 5550 0113' },
  { name: 'Daniel & Mei Whitlock', email: 'whitlock@mail.example', phone: '03 5550 0114' },
]

const STREETS = ['Quarry Lane', 'Wattlebird Crescent', 'Ironstone Road', 'Bellbird Way', 'Redgum Parade', 'Banksia Court', 'Lyrebird Drive', 'Saltbush Street', 'Paperbark Avenue', 'Corella Close']
const SUBURBS = ['Ashvale', 'Brindle Park', 'Coralwood', 'Dunmore Heights', 'Elmsford', 'Fernleigh', 'Glenrock', 'Harrow Bay', 'Juniper Hill', 'Kestrel Vale']
const NOTES = [
  'Undermount sink supplied by client: collect before cutting.',
  'Site access via rear lane. Call 30 minutes before delivery.',
  'Templated on site. Check the drawing revision before cutting.',
  'Waterfall end on island: keep the vein running over the edge.',
  'Install crew booked. Do not move the due date without calling the builder.',
]
const REMAKE_REASONS: RemakeReason[] = ['chipped_edge', 'cracked_piece', 'measurement_error', 'polish_defect', 'vein_mismatch', 'handling_damage', 'wrong_cutout']

// ---------------------------------------------------------------------------
// Deterministic randomness (mulberry32): the same seed always gives the same numbers.
type Rng = () => number
function mulberry32(seed: number): Rng {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]
const between = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const roundTo = (value: number, step: number) => Math.round(value / step) * step
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// Piece templates for typical orders. Sizes in mm.
type Template = 'kitchen' | 'kitchen_island' | 'bathroom' | 'laundry' | 'outdoor' | 'butlers'

function piecesFor(template: Template, rng: Rng, material: SeedMaterial): PieceSpec[] {
  const maxLength = material.length - 2 * 20 - 60 // stay comfortably inside the usable slab
  const len = (min: number, max: number) => Math.min(roundTo(between(rng, min, max), 10), maxLength)
  const profile = (): EdgeProfile => pick(rng, ['pencil_round', 'pencil_round', 'pencil_round', 'arris', 'arris', 'bullnose', 'ogee'] as const)
  const piece = (name: string, lengthMm: number, widthMm: number, edgeProfile: EdgeProfile, polishedEdges: EdgeSide[], cutouts = 0, quantity = 1): PieceSpec => ({
    name,
    lengthMm,
    widthMm,
    quantity,
    edgeProfile,
    polishedEdges,
    cutouts,
  })
  switch (template) {
    case 'kitchen': {
      const p = profile()
      return [
        piece('Main bench', len(2400, 2900), 650, p, ['front'], 2),
        piece('Back bench', len(1800, 2500), 600, p, ['front'], between(rng, 0, 1)),
        piece('Splashback', len(1800, 2400), roundTo(between(rng, 600, 700), 10), 'arris', []),
      ]
    }
    case 'kitchen_island': {
      const islandProfile = pick(rng, ['mitred_apron', 'mitred_apron', 'bullnose'] as const)
      return [
        piece('Island', len(2200, 2600), roundTo(between(rng, 900, 1100), 10), islandProfile, ['front', 'back', 'left', 'right'], between(rng, 0, 1)),
        piece('Main bench', len(2300, 2800), 650, profile(), ['front'], 2),
      ]
    }
    case 'bathroom':
      return [
        piece('Vanity top', len(900, 1500), roundTo(between(rng, 460, 520), 10), profile(), ['front', 'left'], between(rng, 1, 2), between(rng, 1, 2)),
        piece('Niche shelf', 600, 300, 'arris', ['front'], 0, 2),
      ]
    case 'laundry':
      return [
        piece('Laundry bench', len(1400, 1900), 600, profile(), ['front'], 1),
        piece('Splashback', len(1400, 1900), 400, 'arris', []),
      ]
    case 'outdoor':
      return [piece('BBQ bench', len(2000, 2600), 700, 'pencil_round', ['front', 'left', 'right'], 1)]
    case 'butlers':
      return [
        piece("Butler's pantry bench", len(1600, 2200), 600, profile(), ['front'], 1),
        piece('Pantry shelf', len(900, 1200), 350, 'arris', ['front'], 0, 2),
      ]
  }
}

// ---------------------------------------------------------------------------
// Job histories

interface Transition {
  type: 'created' | 'advanced' | 'remake'
  from: Stage | null
  to: Stage
  gapDays: number // working days after the previous event
  reason?: RemakeReason
}

/** The full path to "dispatched", optionally with one remake after `remakeAt`. */
function fullPath(rng: Rng, remakeAt: 'finishing' | 'quality_check' | null): Transition[] {
  const gap: Record<WorkStage, () => number> = {
    slab_allocation: () => between(rng, 0, 1),
    cutting: () => between(rng, 1, 2),
    finishing: () => between(rng, 1, 3),
    quality_check: () => between(rng, 0, 1),
    dispatch: () => between(rng, 1, 2),
  }
  const path: Transition[] = [{ type: 'created', from: null, to: 'slab_allocation', gapDays: 0 }]
  let stage: Stage = 'slab_allocation'
  let remade = false
  while (stage !== 'dispatched') {
    const to: Stage = nextStage(stage)!
    path.push({ type: 'advanced', from: stage, to, gapDays: gap[stage as WorkStage]() })
    stage = to
    if (!remade && remakeAt === stage) {
      remade = true
      path.push({ type: 'remake', from: stage, to: 'cutting', gapDays: between(rng, 0, 1), reason: pick(rng, REMAKE_REASONS) })
      stage = 'cutting'
    }
  }
  return path
}

/** Keeps the path up to the last time the job entered `stage` (the job is "in" that stage now). */
function pathUntil(path: Transition[], stage: Stage): Transition[] {
  let last = -1
  path.forEach((t, i) => {
    if (t.to === stage) last = i
  })
  return path.slice(0, last + 1)
}

interface TimedTransition extends Transition {
  date: IsoDate
  minutes: number // minutes after midnight, factory time
}

/** Gives each transition a date and time, ending on `endDate`. Times stay within working hours. */
function schedule(rng: Rng, path: Transition[], endDate: IsoDate): TimedTransition[] {
  let date = endDate // provisional start; shifted below
  let minutes = between(rng, 7 * 60, 11 * 60)
  const timed: TimedTransition[] = path.map((t, i) => {
    if (i > 0) {
      if (t.gapDays === 0) {
        minutes += between(rng, 40, 180)
        if (minutes > 15 * 60 + 30) {
          date = addWorkingDays(date, 1)
          minutes = between(rng, 6 * 60 + 45, 9 * 60)
        }
      } else {
        date = addWorkingDays(date, t.gapDays)
        minutes = between(rng, 6 * 60 + 45, 15 * 60)
      }
    }
    return { ...t, date, minutes: roundTo(minutes, 5) }
  })
  // Shift everything (by working days, so weekends stay free) so the last event lands on endDate.
  const shift = workingDaysBetween(timed[timed.length - 1].date, endDate)
  return timed.map((t) => ({ ...t, date: addWorkingDays(t.date, shift) }))
}

interface JobSpec {
  template: Template
  materialCode: string
  clientIndex: number
  stage: Stage // the stage the job is in now
  remakeAt: 'finishing' | 'quality_check' | null
  endOffset: number // working days ago that the job entered its current stage
  dueOffset: number | null // working days from today (null = derive from history)
  priority: 'normal' | 'urgent'
  webhookRef?: string
}

/** The 17 jobs on the factory floor right now, chosen to give the capacity plan something to show. */
const ACTIVE_JOBS: JobSpec[] = [
  { template: 'kitchen_island', materialCode: 'GRA-IRB', clientIndex: 0, stage: 'slab_allocation', remakeAt: null, endOffset: 1, dueOffset: 9, priority: 'normal' },
  { template: 'bathroom', materialCode: 'MAR-SNG', clientIndex: 7, stage: 'slab_allocation', remakeAt: null, endOffset: 1, dueOffset: 11, priority: 'normal' },
  { template: 'kitchen', materialCode: 'GRA-NGT', clientIndex: 3, stage: 'slab_allocation', remakeAt: null, endOffset: 2, dueOffset: 7, priority: 'normal' },
  { template: 'laundry', materialCode: 'POR-ASH', clientIndex: 10, stage: 'slab_allocation', remakeAt: null, endOffset: 1, dueOffset: 5, priority: 'urgent' },
  { template: 'kitchen_island', materialCode: 'SIN-BSH', clientIndex: 9, stage: 'cutting', remakeAt: null, endOffset: 1, dueOffset: 6, priority: 'normal' },
  { template: 'kitchen', materialCode: 'GRA-WTL', clientIndex: 1, stage: 'cutting', remakeAt: null, endOffset: 1, dueOffset: 4, priority: 'normal' },
  { template: 'bathroom', materialCode: 'MAR-CLD', clientIndex: 11, stage: 'cutting', remakeAt: 'quality_check', endOffset: 1, dueOffset: 2, priority: 'urgent' },
  { template: 'kitchen_island', materialCode: 'QTZ-TDW', clientIndex: 4, stage: 'finishing', remakeAt: null, endOffset: 1, dueOffset: 5, priority: 'normal' },
  { template: 'outdoor', materialCode: 'GRA-IRB', clientIndex: 8, stage: 'finishing', remakeAt: null, endOffset: 2, dueOffset: 3, priority: 'normal' },
  { template: 'butlers', materialCode: 'POR-SLT', clientIndex: 5, stage: 'finishing', remakeAt: null, endOffset: 1, dueOffset: 8, priority: 'normal' },
  { template: 'kitchen', materialCode: 'MAR-SNG', clientIndex: 12, stage: 'finishing', remakeAt: null, endOffset: 1, dueOffset: 4, priority: 'normal' },
  { template: 'bathroom', materialCode: 'POR-SLT', clientIndex: 7, stage: 'quality_check', remakeAt: null, endOffset: 1, dueOffset: 3, priority: 'normal' },
  { template: 'kitchen', materialCode: 'GRA-IRB', clientIndex: 2, stage: 'quality_check', remakeAt: 'finishing', endOffset: 1, dueOffset: 3, priority: 'normal' },
  { template: 'laundry', materialCode: 'LIM-SHC', clientIndex: 13, stage: 'quality_check', remakeAt: null, endOffset: 2, dueOffset: 4, priority: 'normal' },
  { template: 'kitchen_island', materialCode: 'POR-ASH', clientIndex: 6, stage: 'dispatch', remakeAt: null, endOffset: 1, dueOffset: 0, priority: 'normal' },
  { template: 'bathroom', materialCode: 'SIN-BSH', clientIndex: 7, stage: 'dispatch', remakeAt: null, endOffset: 2, dueOffset: -1, priority: 'urgent' },
  { template: 'outdoor', materialCode: 'GRA-WTL', clientIndex: 8, stage: 'dispatch', remakeAt: null, endOffset: 1, dueOffset: 2, priority: 'normal', webhookRef: 'QP-24817' },
]

/** 23 finished jobs spread over the last eight weeks, for the KPIs. */
function dispatchedJobSpecs(rng: Rng): JobSpec[] {
  // Mostly kitchens, like a real benchtop shop.
  const templates: Template[] = ['kitchen', 'kitchen', 'kitchen', 'kitchen_island', 'kitchen_island', 'bathroom', 'laundry', 'outdoor', 'butlers']
  const specs: JobSpec[] = []
  for (let k = 0; k < 23; k++) {
    specs.push({
      template: pick(rng, templates),
      materialCode: pick(rng, MATERIALS).code,
      clientIndex: between(rng, 0, CLIENTS.length - 1),
      stage: 'dispatched',
      remakeAt: [3, 9, 14, 20].includes(k) ? pick(rng, ['finishing', 'quality_check'] as const) : null,
      endOffset: 1 + Math.round(k * 1.75), // from yesterday back to ~8 weeks ago
      dueOffset: null,
      priority: rng() < 0.15 ? 'urgent' : 'normal',
    })
  }
  return specs
}

// ---------------------------------------------------------------------------

export interface SeedSummary {
  users: number
  materials: number
  jobs: number
  activeJobs: number
  dispatchedJobs: number
  slabs: number
  events: number
}

export async function isDatabaseEmpty(db: pg.ClientBase | pg.Pool): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')
  return rows[0].n === 0
}

/**
 * Deletes ALL data and inserts the demo data set. Run it inside a transaction
 * (the CLI and the reset endpoint do) so a failure leaves the old data untouched.
 */
export async function seedDemoData(db: pg.ClientBase, options: { today?: IsoDate } = {}): Promise<SeedSummary> {
  const tz = config.factoryTimezone
  const today = options.today ?? todayInZone(tz)
  const rng = mulberry32(20_241_118)
  const at = (date: IsoDate, minutes: number) => zonedTimeToUtc(date, hhmm(minutes), tz)

  await db.query(
    `TRUNCATE webhook_events, stage_events, slabs, job_pieces, jobs, clients, sessions, users, operators, machines, materials
     RESTART IDENTITY CASCADE`,
  )

  // People, machines and stone
  const passwords = new Map(DEMO_ACCOUNTS.map((a) => [a.username, a.password]))
  const userRows = []
  for (const u of USERS) userRows.push([u.username, u.displayName, u.role, await hashPassword(passwords.get(u.username)!)])
  const users = await insertRows<{ id: number; username: string }>(db, 'users', ['username', 'display_name', 'role', 'password_hash'], userRows, 'id, username')
  const managerId = users.find((u) => u.username === 'manager')!.id
  const kioskId = users.find((u) => u.username === 'kiosk')!.id

  const operators = await insertRows<{ id: number; team: OperatorTeam }>(db, 'operators', ['name', 'team'], OPERATORS.map((o) => [o.name, o.team]), 'id, team')
  const operatorFor = (stage: Stage): number => {
    const team: OperatorTeam = stage === 'slab_allocation' ? 'yard' : stage === 'cutting' ? 'saw' : stage === 'finishing' ? pick(rng, ['cnc', 'finishing'] as const) : stage === 'quality_check' ? 'qc' : 'dispatch'
    return pick(rng, operators.filter((o) => o.team === team)).id
  }

  await insertRows(db, 'machines', ['code', 'name', 'work_centre', 'hours_per_day'], MACHINES.map((m) => [m.code, m.name, m.workCentre, m.hoursPerDay]))

  const materialIds = await insertRows<{ id: number; code: string }>(
    db,
    'materials',
    ['code', 'name', 'material_type', 'finish', 'thickness_mm', 'slab_length_mm', 'slab_width_mm', 'reorder_level', 'swatch_hex'],
    MATERIALS.map((m) => [m.code, m.name, m.type, m.finish, m.thickness, m.length, m.width, m.reorder, m.swatch]),
    'id, code',
  )
  const materialIdByCode = new Map(materialIds.map((m) => [m.code, m.id]))
  const materialByCode = new Map(MATERIALS.map((m) => [m.code, m]))

  const clientIds = await insertRows<{ id: number }>(db, 'clients', ['name', 'email', 'phone'], CLIENTS.map((c) => [c.name, c.email, c.phone]), 'id')

  // Build every job in memory first, oldest first, so job numbers increase with age.
  const specs = [...dispatchedJobSpecs(rng), ...ACTIVE_JOBS]
  const built = specs.map((spec, index) => {
    const material = materialByCode.get(spec.materialCode)!
    const pieces = piecesFor(spec.template, rng, material)
    const cuttingList = generateCuttingList(pieces, {
      materialType: material.type,
      thicknessMm: material.thickness,
      slabLengthMm: material.length,
      slabWidthMm: material.width,
    })
    const path = spec.stage === 'dispatched' ? fullPath(rng, spec.remakeAt) : pathUntil(fullPath(rng, spec.remakeAt), spec.stage)
    const events = schedule(rng, path, addWorkingDays(today, -spec.endOffset))
    const created = events[0]
    const last = events[events.length - 1]
    const span = workingDaysBetween(created.date, last.date)
    const dueDate =
      spec.dueOffset !== null
        ? addWorkingDays(today, spec.dueOffset)
        : addWorkingDays(created.date, span + pick(rng, [-2, -1, 0, 1, 1, 2, 2, 3, 3, 4]))
    return { spec, index, material, pieces, cuttingList, events, created, last, dueDate }
  })
  built.sort((a, b) => a.created.date.localeCompare(b.created.date) || a.created.minutes - b.created.minutes || a.index - b.index)

  const jobRows = built.map((job, i) => [
    clientIds[job.spec.clientIndex].id,
    materialIdByCode.get(job.spec.materialCode),
    `${between(rng, 2, 148)} ${pick(rng, STREETS)}, ${pick(rng, SUBURBS)} VIC`,
    `DWG-${4100 + i * 7 + between(rng, 0, 6)} Rev ${pick(rng, ['A', 'A', 'B', 'C'])}`,
    job.dueDate,
    job.spec.priority,
    rng() < 0.35 ? pick(rng, NOTES) : null,
    job.last.to,
    at(job.last.date, job.last.minutes),
    `demo-${String(i + 1).padStart(2, '0')}-${Math.floor(rng() * 1e12).toString(36)}`,
    job.spec.webhookRef ? 'webhook' : 'seed',
    job.spec.webhookRef ?? null,
    job.spec.webhookRef ? null : managerId,
    at(job.created.date, job.created.minutes),
    job.last.to === 'dispatched' ? at(job.last.date, job.last.minutes) : null,
  ])
  const jobs = await insertRows<{ id: number; share_token: string }>(
    db,
    'jobs',
    ['client_id', 'material_id', 'site_address', 'drawing_ref', 'due_date', 'priority', 'notes', 'current_stage', 'stage_updated_at', 'share_token', 'source', 'external_ref', 'created_by', 'created_at', 'dispatched_at'],
    jobRows,
    'id, share_token',
  )
  const jobIdByToken = new Map(jobs.map((j) => [j.share_token, j.id]))
  const jobIds = jobRows.map((row) => jobIdByToken.get(row[9] as string)!)

  const pieceRows = built.flatMap((job, i) =>
    job.pieces.map((p, n) => [jobIds[i], n + 1, p.name, p.lengthMm, p.widthMm, p.quantity, p.edgeProfile, p.polishedEdges, p.cutouts]),
  )
  const pieces = await insertRows<{ id: number; job_id: number }>(
    db,
    'job_pieces',
    ['job_id', 'piece_no', 'name', 'length_mm', 'width_mm', 'quantity', 'edge_profile', 'polished_edges', 'cutouts'],
    pieceRows,
    'id, job_id',
  )

  // Stage history and the slabs each job used
  const eventRows: unknown[][] = []
  const slabRows: unknown[][] = []
  const rack = () => `${pick(rng, ['A', 'B', 'C', 'D', 'E'])}${between(rng, 1, 8)}`
  built.forEach((job, i) => {
    const jobId = jobIds[i]
    const jobPieces = pieces.filter((p) => p.job_id === jobId)
    const materialId = materialIdByCode.get(job.spec.materialCode)!
    let allocatedAt: Date | null = null
    const slabsForJob: { allocatedAt: Date; consumedAt: Date | null }[] = []

    for (const e of job.events) {
      const when = at(e.date, e.minutes)
      if (e.type === 'created') {
        eventRows.push([jobId, 'created', null, 'slab_allocation', null, null, null, job.spec.webhookRef ? `Received by webhook (order ${job.spec.webhookRef})` : null, null, job.spec.webhookRef ? null : managerId, when])
        continue
      }
      if (e.type === 'remake') {
        const piece = pick(rng, jobPieces)
        eventRows.push([jobId, 'remake', e.from, e.to, null, e.reason, piece.id, null, operatorFor(e.from!), kioskId, when])
        // The replacement piece needs fresh stone: one extra slab.
        slabsForJob.push({ allocatedAt: when, consumedAt: null })
        continue
      }
      const from = e.from as WorkStage
      const hours = roundTo(job.cuttingList.hours.labour[from] * (0.85 + rng() * 0.5), 0.05)
      eventRows.push([jobId, 'advanced', from, e.to, hours, null, null, null, operatorFor(from), kioskId, when])
      if (from === 'slab_allocation') {
        allocatedAt = when
        for (let s = 0; s < job.cuttingList.totals.slabsRequired; s++) slabsForJob.push({ allocatedAt: when, consumedAt: null })
      }
      if (from === 'cutting') for (const slab of slabsForJob) slab.consumedAt ??= when
    }

    for (const slab of slabsForJob) {
      const received = at(addDays(allocatedAt ? job.created.date : today, -between(rng, 5, 30)), 10 * 60)
      slabRows.push([materialId, job.material.length, job.material.width, slab.consumedAt ? 'consumed' : 'allocated', rack(), jobId, received, slab.allocatedAt, slab.consumedAt])
    }
  })

  // Stock still in the yard
  for (const m of MATERIALS) {
    for (let n = 0; n < m.inStock; n++) {
      const received = at(addDays(today, -between(rng, 3, 40)), 10 * 60)
      slabRows.push([materialIdByCode.get(m.code), m.length, m.width, 'available', rack(), null, received, null, null])
    }
  }
  slabRows.sort((a, b) => (a[6] as Date).getTime() - (b[6] as Date).getTime()) // codes follow delivery order

  await insertRows(db, 'slabs', ['material_id', 'length_mm', 'width_mm', 'status', 'rack_location', 'job_id', 'received_at', 'allocated_at', 'consumed_at'], slabRows)
  eventRows.sort((a, b) => (a[10] as Date).getTime() - (b[10] as Date).getTime())
  await insertRows(db, 'stage_events', ['job_id', 'event_type', 'from_stage', 'to_stage', 'labour_hours', 'remake_reason', 'piece_id', 'note', 'operator_id', 'user_id', 'created_at'], eventRows)

  // A few webhook deliveries so the Integrations page has a log to show
  const webhookJob = built.findIndex((j) => j.spec.webhookRef)
  if (webhookJob >= 0) {
    const createdAt = at(built[webhookJob].created.date, built[webhookJob].created.minutes)
    const minutes = (n: number) => new Date(createdAt.getTime() + n * 60_000)
    await insertRows(db, 'webhook_events', ['received_at', 'external_ref', 'status', 'http_status', 'job_id', 'error'], [
      [minutes(-1440), 'QP-24790', 'rejected', 401, null, 'Signature does not match'],
      [minutes(-35), 'QP-24816', 'rejected', 422, null, 'materialCode: Unknown stone code "QTZ-ARC"'],
      [createdAt, 'QP-24817', 'created', 201, jobIds[webhookJob], null],
      [minutes(3), 'QP-24817', 'duplicate', 200, jobIds[webhookJob], null],
    ])
  }

  const dispatched = built.filter((j) => j.last.to === 'dispatched').length
  return {
    users: users.length,
    materials: MATERIALS.length,
    jobs: built.length,
    activeJobs: built.length - dispatched,
    dispatchedJobs: dispatched,
    slabs: slabRows.length,
    events: eventRows.length,
  }
}

