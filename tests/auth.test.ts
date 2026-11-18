import { beforeEach, describe, expect, it } from 'vitest'
import { PASSWORD, api, bearer, resetDatabase, tokenFor } from './helpers'

beforeEach(resetDatabase)

describe('POST /api/auth/login', () => {
  it('returns a token and the user for correct credentials', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'manager', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(res.body.user).toMatchObject({ username: 'manager', role: 'manager' })
  })

  it('accepts usernames in any case and with spaces around them', async () => {
    const res = await api().post('/api/auth/login').send({ username: '  Manager ', password: PASSWORD })
    expect(res.status).toBe(200)
  })

  it('rejects a wrong password with 401', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'manager', password: 'nope' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects an unknown user with the same message as a wrong password', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'ghost', password: 'nope' })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Wrong username or password')
  })

  it('validates the body and lists each problem', async () => {
    const res = await api().post('/api/auth/login').send({ username: '' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['password', 'username'])
  })

  it('answers malformed JSON with 400 and a request id', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"username": ')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
  })
})

describe('sessions', () => {
  it('GET /api/auth/me needs a token', async () => {
    const res = await api().get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('GET /api/auth/me returns the signed-in user', async () => {
    const token = await tokenFor('kiosk')
    const res = await api().get('/api/auth/me').set(bearer(token))
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe('kiosk')
  })

  it('logging out invalidates the token', async () => {
    const token = await tokenFor('manager')
    expect((await api().post('/api/auth/logout').set(bearer(token))).status).toBe(204)
    expect((await api().get('/api/auth/me').set(bearer(token))).status).toBe(401)
  })

  it('stores only a hash of the token', async () => {
    const token = await tokenFor('manager')
    const { getPool } = await import('../server/db/pool')
    const { rows } = await getPool().query('SELECT token_hash FROM sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toBe(token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('roles', () => {
  it('blocks the kiosk from office screens (403)', async () => {
    const token = await tokenFor('kiosk')
    expect((await api().get('/api/jobs').set(bearer(token))).status).toBe(403)
    expect((await api().get('/api/kpis').set(bearer(token))).status).toBe(403)
    expect((await api().get('/api/slabs').set(bearer(token))).status).toBe(403)
  })

  it('lets the kiosk see the kiosk job list and operators', async () => {
    const token = await tokenFor('kiosk')
    expect((await api().get('/api/kiosk/jobs').set(bearer(token))).status).toBe(200)
    expect((await api().get('/api/operators').set(bearer(token))).status).toBe(200)
  })

  it('keeps user management for admins', async () => {
    expect((await api().get('/api/users').set(bearer(await tokenFor('manager')))).status).toBe(403)
    expect((await api().get('/api/users').set(bearer(await tokenFor('admin')))).status).toBe(200)
  })
})

describe('meta and errors', () => {
  it('GET /api/meta is public and lists demo accounts in demo mode', async () => {
    const res = await api().get('/api/meta')
    expect(res.status).toBe(200)
    expect(res.body.demoMode).toBe(true)
    expect(res.body.demoAccounts.map((a: { role: string }) => a.role)).toEqual(['admin', 'manager', 'kiosk'])
  })

  it('GET /api/health reports the database', async () => {
    const res = await api().get('/api/health')
    expect(res.body).toMatchObject({ ok: true, database: 'up' })
  })

  it('unknown API routes return JSON 404, signed in or not', async () => {
    const anonymous = await api().get('/api/nope')
    expect(anonymous.status).toBe(404)
    expect(anonymous.body.error.code).toBe('NOT_FOUND')
    // Regression: a router-wide role guard once turned unknown routes into 401/403.
    const asManager = await api().get('/api/nope').set(bearer(await tokenFor('manager')))
    expect(asManager.status).toBe(404)
  })

  it('sends security headers', async () => {
    const res = await api().get('/api/health')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
