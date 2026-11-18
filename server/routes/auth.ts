import { Router } from 'express'
import { loginSchema } from '../../shared/schemas'
import type { LoginResponse } from '../../shared/types'
import { requireRole } from '../auth/middleware'
import { createSession, deleteSession } from '../auth/sessions'
import { HttpError } from '../http/errors'
import { loginLimiter } from '../http/rateLimits'
import { parse } from '../http/validate'
import { checkLogin } from '../services/users'

export const authRoutes = Router()

// POST /api/auth/login  { username, password } → { token, expiresAt, user }
authRoutes.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = parse(loginSchema, req.body)
  const user = await checkLogin(username, password)
  if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong username or password')
  const session = await createSession(user.id, user.role)
  const body: LoginResponse = { token: session.token, expiresAt: session.expiresAt, user }
  res.json(body)
})

// POST /api/auth/logout → 204. Deletes this session only.
authRoutes.post('/logout', requireRole(), async (req, res) => {
  if (req.sessionToken) await deleteSession(req.sessionToken)
  res.status(204).end()
})

// GET /api/auth/me → { user }. The React app calls this on load to restore a session.
authRoutes.get('/me', requireRole(), (req, res) => {
  res.json({ user: req.user })
})
