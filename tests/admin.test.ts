import { beforeEach, describe, expect, it } from 'vitest'
import { api, bearer, resetDatabase, tokenFor } from './helpers'

let admin: string

beforeEach(async () => {
  await resetDatabase()
  admin = await tokenFor('admin')
})

describe('user management (admin)', () => {
  it('creates a user who can then sign in', async () => {
    const res = await api().post('/api/users').set(bearer(admin)).send({ username: 'Bay2.Kiosk', displayName: 'Bay 2 tablet', role: 'kiosk', password: 'long-enough' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ username: 'bay2.kiosk', role: 'kiosk', active: true })
    expect(res.body).not.toHaveProperty('passwordHash')
    const login = await api().post('/api/auth/login').send({ username: 'bay2.kiosk', password: 'long-enough' })
    expect(login.status).toBe(200)
  })

  it('rejects duplicate usernames and weak passwords', async () => {
    const dup = await api().post('/api/users').set(bearer(admin)).send({ username: 'manager', displayName: 'X', role: 'manager', password: 'long-enough' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('USERNAME_TAKEN')
    const weak = await api().post('/api/users').set(bearer(admin)).send({ username: 'new.user', displayName: 'X', role: 'manager', password: 'short' })
    expect(weak.status).toBe(422)
    expect(weak.body.error.details[0].path).toBe('password')
  })

  it('deactivating a user signs them out everywhere', async () => {
    const managerToken = await tokenFor('manager')
    const res = await api().patch('/api/users/2').set(bearer(admin)).send({ active: false })
    expect(res.status).toBe(200)
    expect((await api().get('/api/auth/me').set(bearer(managerToken))).status).toBe(401)
    expect((await api().post('/api/auth/login').send({ username: 'manager', password: 'test-password' })).status).toBe(401)
  })

  it('stops admins locking themselves out', async () => {
    const res = await api().patch('/api/users/1').set(bearer(admin)).send({ active: false })
    expect(res.status).toBe(422)
  })
})

describe('machines (admin)', () => {
  it('updates machine hours, which the capacity plan then uses', async () => {
    const res = await api().patch('/api/machines/1').set(bearer(admin)).send({ hoursPerDay: 15.2 })
    expect(res.status).toBe(200)
    const plan = await api().get('/api/capacity').set(bearer(admin))
    expect(plan.body.resources.sawHoursPerDay).toBe(15.2)
    expect((await api().patch('/api/machines/1').set(bearer(await tokenFor('manager'))).send({ hoursPerDay: 1 })).status).toBe(403)
  })
})

describe('POST /api/admin/reset-demo', () => {
  it('loads the full demo data set and signs everyone out', async () => {
    const res = await api().post('/api/admin/reset-demo').set(bearer(admin))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ jobs: 40, activeJobs: 17, dispatchedJobs: 23, users: 3 })
    expect((await api().get('/api/auth/me').set(bearer(admin))).status).toBe(401)

    // The demo logins work afterwards, and the demo data is internally consistent.
    const login = await api().post('/api/auth/login').send({ username: 'manager', password: 'manager123' })
    const token = login.body.token
    const jobs = await api().get('/api/jobs?status=all').set(bearer(token))
    expect(jobs.body).toHaveLength(40)
    const kpis = await api().get('/api/kpis?days=90').set(bearer(token))
    expect(kpis.body.throughput.jobs).toBe(23)
    const plan = await api().get('/api/capacity').set(bearer(token))
    expect(plan.body.jobs).toHaveLength(17)
  })
})
