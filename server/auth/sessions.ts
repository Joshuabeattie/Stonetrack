// Sign-in sessions.
//
// On login we create a random token, give it to the browser, and store only its
// SHA-256 hash in the sessions table. The browser sends the token back in an
// `Authorization: Bearer <token>` header on every request.
//
// Why a header and not a cookie? Replit's preview shows the app inside an iframe on
// another site, where browsers don't send normal (SameSite) cookies. A header works
// everywhere. Trade-off: the token lives in localStorage, so it must be protected
// from XSS — React escapes output and the server sends a strict Content-Security-Policy.
import { createHash, randomBytes } from 'node:crypto'
import type { Role } from '../../shared/catalog'
import type { AuthUser } from '../../shared/types'
import { config } from '../config'
import { query } from '../db/pool'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: number, role: Role): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url')
  const rows = await query<{ expires_at: Date }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3::int))
     RETURNING expires_at`,
    [userId, hashToken(token), config.sessionHours[role]],
  )
  // Housekeeping: clear out sessions that have expired.
  await query('DELETE FROM sessions WHERE expires_at < now()')
  return { token, expiresAt: rows[0].expires_at.toISOString() }
}

/** The signed-in user for a token, or null if the token is unknown, expired or the user was deactivated. */
export async function findSessionUser(token: string): Promise<AuthUser | null> {
  const rows = await query<{ id: number; username: string; display_name: string; role: Role }>(
    `SELECT u.id, u.username, u.display_name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [hashToken(token)],
  )
  const row = rows[0]
  return row ? { id: row.id, username: row.username, displayName: row.display_name, role: row.role } : null
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
}

export async function deleteSessionsForUser(userId: number): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId])
}
