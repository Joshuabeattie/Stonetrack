// Reference data: stone types, operators, machines and client names.
import type { Machine, Material, Operator } from '../../shared/types'
import {
  MATERIAL_COLUMNS,
  toMachine,
  toMaterial,
  toOperator,
  type MachineRow,
  type MaterialRow,
  type OperatorRow,
} from '../db/mappers'
import { getPool, query, type Db } from '../db/pool'
import { notFound } from '../http/errors'

export async function listMaterials(db: Db = getPool()): Promise<Material[]> {
  const rows = await query<MaterialRow>(
    `SELECT ${MATERIAL_COLUMNS} FROM materials m WHERE m.active ORDER BY m.material_type, m.name`,
    [],
    db,
  )
  return rows.map(toMaterial)
}

export async function getMaterial(id: number, db: Db = getPool()): Promise<Material | null> {
  const rows = await query<MaterialRow>(`SELECT ${MATERIAL_COLUMNS} FROM materials m WHERE m.id = $1 AND m.active`, [id], db)
  return rows[0] ? toMaterial(rows[0]) : null
}

export async function getMaterialByCode(code: string, db: Db = getPool()): Promise<Material | null> {
  const rows = await query<MaterialRow>(
    `SELECT ${MATERIAL_COLUMNS} FROM materials m WHERE upper(m.code) = upper($1) AND m.active`,
    [code],
    db,
  )
  return rows[0] ? toMaterial(rows[0]) : null
}

export async function listOperators(db: Db = getPool()): Promise<Operator[]> {
  const rows = await query<OperatorRow>('SELECT id, name, team FROM operators WHERE active ORDER BY name', [], db)
  return rows.map(toOperator)
}

export async function isActiveOperator(id: number, db: Db = getPool()): Promise<boolean> {
  const rows = await query('SELECT 1 FROM operators WHERE id = $1 AND active', [id], db)
  return rows.length > 0
}

export async function listMachines(db: Db = getPool()): Promise<Machine[]> {
  const rows = await query<MachineRow>(
    'SELECT id, code, name, work_centre, hours_per_day, active FROM machines ORDER BY work_centre, code',
    [],
    db,
  )
  return rows.map(toMachine)
}

export async function updateMachineHours(id: number, hoursPerDay: number): Promise<Machine> {
  const rows = await query<MachineRow>(
    `UPDATE machines SET hours_per_day = $2 WHERE id = $1
     RETURNING id, code, name, work_centre, hours_per_day, active`,
    [id, hoursPerDay],
  )
  if (!rows[0]) throw notFound('Machine')
  return toMachine(rows[0])
}

export async function listClientNames(): Promise<string[]> {
  const rows = await query<{ name: string }>('SELECT name FROM clients ORDER BY name')
  return rows.map((r) => r.name)
}
