import type { RequestHandler } from 'express'
import type { Role } from '../../shared/catalog'
import { forbidden, unauthenticated } from '../http/errors'
import { findSessionUser } from './sessions'

/** Reads the Bearer token (if any) and attaches the signed-in user to req.user. Never rejects. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization')
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()
    if (token) {
      const user = await findSessionUser(token)
      if (user) {
        req.user = user
        req.sessionToken = token
      }
    }
  }
  next()
}

/**
 * Route guard. `requireRole()` = any signed-in user; `requireRole('admin')` = admins only.
 * 401 means "not signed in", 403 means "signed in, but your role can't do this".
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthenticated()
    if (roles.length > 0 && !roles.includes(req.user.role)) throw forbidden()
    next()
  }
}

export const STAFF: Role[] = ['admin', 'manager'] // office roles
export const FLOOR: Role[] = ['admin', 'manager', 'kiosk'] // anyone who can move jobs along
