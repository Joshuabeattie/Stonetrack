// Shared test setup: an app instance, a known small data set, and login helpers.
import request from 'supertest'
import { afterAll } from 'vitest'
import { addWorkingDays, todayInZone } from '../shared/dates'
import type { JobInput } from '../shared/schemas'
import { createApp } from '../server/app'
import { hashPassword } from '../server/auth/passwords'
import { config } from '../server/config'
import { closePool, getPool } from '../server/db/pool'
import { TEST_SCHEMA } from './testDb'

export const app = createApp()
export const api = () => request(app)

export const PASSWORD = 'test-password'

const TABLES = ['webhook_events', 'stage_events', 'slabs', 'job_pieces', 'jobs', 'clients', 'sessions', 'users', 'operators', 'machines', 'materials']

let passwordHash: string | undefined

/**
 * Empties every table and inserts a small, known data set:
 *  users     1 admin, 2 manager, 3 kiosk (password: test-password)
 *  operators 1 "Sam Saw" (saw), 2 "Quinn QC" (qc)
 *  machines  saw 7.6 h/day, cnc 7.6 h/day
 *  materials 1 GRA-TST granite 3000×1800, 2 MAR-TST marble 2800×1700
 *  slabs     1–3 granite (available), 4 marble (available)
 * Table names are schema-qualified so this can only ever touch the test schema.
 */
export async function resetDatabase() {
  const pool = getPool()
  await pool.query(`TRUNCATE ${TABLES.map((t) => `${TEST_SCHEMA}.${t}`).join(', ')} RESTART IDENTITY CASCADE`)
  passwordHash ??= await hashPassword(PASSWORD)
  await pool.query(
    `INSERT INTO users (username, display_name, role, password_hash) VALUES
       ('admin', 'Test Admin', 'admin', $1), ('manager', 'Test Manager', 'manager', $1), ('kiosk', 'Test Kiosk', 'kiosk', $1)`,
    [passwordHash],
  )
  await pool.query(`INSERT INTO operators (name, team) VALUES ('Sam Saw', 'saw'), ('Quinn QC', 'qc')`)
  await pool.query(`INSERT INTO machines (code, name, work_centre, hours_per_day) VALUES ('SAW-1', 'Saw', 'saw', 7.6), ('CNC-1', 'CNC', 'cnc', 7.6)`)
  await pool.query(
    `INSERT INTO materials (code, name, material_type, finish, thickness_mm, slab_length_mm, slab_width_mm, reorder_level) VALUES
       ('GRA-TST', 'Test Granite', 'granite', 'polished', 20, 3000, 1800, 2),
       ('MAR-TST', 'Test Marble', 'marble', 'honed', 20, 2800, 1700, 1)`,
  )
  await pool.query(
    `INSERT INTO slabs (material_id, length_mm, width_mm, rack_location) VALUES
       (1, 3000, 1800, 'A1'), (1, 3000, 1800, 'A1'), (1, 3000, 1800, 'A2'), (2, 2800, 1700, 'B1')`,
  )
}

export async function tokenFor(username: 'admin' | 'manager' | 'kiosk'): Promise<string> {
  const res = await api().post('/api/auth/login').send({ username, password: PASSWORD })
  if (res.status !== 200) throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.token
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

export const today = () => todayInZone(config.factoryTimezone)
export const workingDaysFromToday = (n: number) => addWorkingDays(today(), n)

/** A valid job: one 2400 × 650 granite bench (fits on one slab). */
export function validJob(overrides: Partial<JobInput> = {}): JobInput {
  return {
    clientName: 'Test Kitchens',
    drawingRef: 'DWG-1 Rev A',
    materialId: 1,
    dueDate: workingDaysFromToday(10),
    priority: 'normal',
    pieces: [{ name: 'Bench', lengthMm: 2400, widthMm: 650, quantity: 1, edgeProfile: 'pencil_round', polishedEdges: ['front'], cutouts: 1 }],
    ...overrides,
  }
}

/** Creates a job through the API as the manager and returns its id. */
export async function createJob(token: string, overrides: Partial<JobInput> = {}): Promise<number> {
  const res = await api().post('/api/jobs').set(bearer(token)).send(validJob(overrides))
  if (res.status !== 201) throw new Error(`Create job failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.id
}

/** Moves a job forward `times` stages, booking 1 labour hour each time. */
export async function advance(token: string, jobId: number, times = 1) {
  for (let i = 0; i < times; i++) {
    // Read the stage from the database: the kiosk role isn't allowed to fetch job details.
    const { rows } = await getPool().query<{ current_stage: string }>('SELECT current_stage FROM jobs WHERE id = $1', [jobId])
    const res = await api()
      .post(`/api/jobs/${jobId}/advance`)
      .set(bearer(token))
      .send({ expectedStage: rows[0].current_stage, operatorId: 1, labourHours: 1 })
    if (res.status !== 200) throw new Error(`Advance failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
}

// Each test file gets its own pool (Vitest isolates modules per file); close it at the end.
afterAll(async () => {
  await closePool()
})
