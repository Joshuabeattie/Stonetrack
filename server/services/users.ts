// Users: checking a login, and admin user management.
import type { Role } from '../../shared/catalog'
import type { AuthUser, UserRecord } from '../../shared/types'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { deleteSessionsForUser } from '../auth/sessions'
import { query } from '../db/pool'
import { conflict, notFound, validationError } from '../http/errors'

interface UserRow {
  id: number
  username: string
  display_name: string
  role: Role
  password_hash: string
  active: boolean
  created_at: Date
}

const toUserRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  active: r.active,
  createdAt: r.created_at.toISOString(),
})

// Used when the username doesn't exist, so a wrong username takes as long to reject
// as a wrong password (otherwise response timing would reveal which usernames exist).
let dummyHash: string | undefined

export async function checkLogin(username: string, password: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>('SELECT * FROM users WHERE username = $1', [username])
  if (!row || !row.active) {
    dummyHash ??= await hashPassword('not-a-real-password')
    await verifyPassword(password, dummyHash)
    return null
  }
  if (!(await verifyPassword(password, row.password_hash))) return null
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role }
}

export async function listUsers(): Promise<UserRecord[]> {
  const rows = await query<UserRow>('SELECT * FROM users ORDER BY role, username')
  return rows.map(toUserRecord)
}

export async function createUser(input: { username: string; displayName: string; role: Role; password: string }): Promise<UserRecord> {
  const existing = await query('SELECT 1 FROM users WHERE username = $1', [input.username])
  if (existing.length > 0) throw conflict(`The username "${input.username}" is already taken`, 'USERNAME_TAKEN')
  const [row] = await query<UserRow>(
    'INSERT INTO users (username, display_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [input.username, input.displayName, input.role, await hashPassword(input.password)],
  )
  return toUserRecord(row)
}

export async function updateUser(
  id: number,
  patch: { displayName?: string; role?: Role; active?: boolean; password?: string },
  actingUser: AuthUser,
): Promise<UserRecord> {
  const [current] = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
  if (!current) throw notFound('User')
  if (id === actingUser.id && (patch.active === false || (patch.role && patch.role !== 'admin'))) {
    throw validationError([{ path: patch.active === false ? 'active' : 'role', message: "You can't deactivate or demote your own account" }])
  }

  const sets: string[] = []
  const params: unknown[] = [id]
  const set = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }
  if (patch.displayName !== undefined) set('display_name', patch.displayName)
  if (patch.role !== undefined) set('role', patch.role)
  if (patch.active !== undefined) set('active', patch.active)
  if (patch.password !== undefined) set('password_hash', await hashPassword(patch.password))

  const [row] = await query<UserRow>(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)
  // A new password, a role change or deactivation signs the user out everywhere.
  if (patch.password !== undefined || patch.active === false || patch.role !== undefined) await deleteSessionsForUser(id)
  return toUserRecord(row)
}
