import { beforeEach, describe, expect, it } from 'vitest'
import { addWorkingDays } from '../shared/dates'
import { api, bearer, createJob, resetDatabase, today, tokenFor, validJob } from './helpers'

let manager: string

beforeEach(async () => {
  await resetDatabase()
  manager = await tokenFor('manager')
})

describe('POST /api/jobs (job intake)', () => {
  it('creates a job with a cutting list, a share token and a first history event', async () => {
    const res = await api().post('/api/jobs').set(bearer(manager)).send(validJob())
    expect(res.status).toBe(201)
    expect(res.headers.location).toBe(`/api/jobs/${res.body.id}`)
    expect(res.body).toMatchObject({ jobNumber: 'J-1001', stage: 'slab_allocation', clientName: 'Test Kitchens', source: 'manual', partCount: 1 })
    expect(res.body.shareToken).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(res.body.cuttingList.items).toHaveLength(1)
    expect(res.body.cuttingList.totals).toMatchObject({ parts: 1, areaM2: 1.56, slabsRequired: 1, cutouts: 1 })
    expect(res.body.cuttingList.hours.labourTotal).toBeGreaterThan(0)
    expect(res.body.events).toHaveLength(1)
    expect(res.body.events[0]).toMatchObject({ eventType: 'created', toStage: 'slab_allocation', userName: 'Test Manager' })
  })

  it('expands quantities into separate parts on the cutting list', async () => {
    const res = await api()
      .post('/api/jobs')
      .set(bearer(manager))
      .send(validJob({ pieces: [{ name: 'Shelf', lengthMm: 900, widthMm: 300, quantity: 3, edgeProfile: 'arris', polishedEdges: [], cutouts: 0 }] }))
    expect(res.status).toBe(201)
    expect(res.body.cuttingList.items.map((i: { label: string }) => i.label)).toEqual(['P1-1', 'P1-2', 'P1-3'])
  })

  it('rejects missing and malformed fields with field-level errors', async () => {
    const res = await api()
      .post('/api/jobs')
      .set(bearer(manager))
      .send({ ...validJob(), clientName: '', dueDate: '2026-02-30', pieces: [] })
    expect(res.status).toBe(422)
    const paths = res.body.error.details.map((d: { path: string }) => d.path)
    expect(paths).toEqual(expect.arrayContaining(['clientName', 'dueDate', 'pieces']))
  })

  it("rejects a due date in the past", async () => {
    const res = await api().post('/api/jobs').set(bearer(manager)).send(validJob({ dueDate: addWorkingDays(today(), -3) }))
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].path).toBe('dueDate')
  })

  it('rejects a piece that will not fit on one slab, and says why', async () => {
    const res = await api()
      .post('/api/jobs')
      .set(bearer(manager))
      .send(validJob({ pieces: [{ name: 'Long bench', lengthMm: 3600, widthMm: 650, quantity: 1, edgeProfile: 'pencil_round', polishedEdges: ['front'], cutouts: 0 }] }))
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].path).toBe('pieces.0.lengthMm')
    expect(res.body.error.details[0].message).toContain('join')
  })

  it('rejects an unknown stone', async () => {
    const res = await api().post('/api/jobs').set(bearer(manager)).send(validJob({ materialId: 999 }))
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].path).toBe('materialId')
  })

  it('reuses an existing client whatever the capitalisation', async () => {
    await createJob(manager)
    await createJob(manager, { clientName: 'test kitchens' })
    const clients = await api().get('/api/clients').set(bearer(manager))
    expect(clients.body).toEqual(['Test Kitchens'])
  })

  it('does not let the kiosk create jobs', async () => {
    const kiosk = await tokenFor('kiosk')
    expect((await api().post('/api/jobs').set(bearer(kiosk)).send(validJob())).status).toBe(403)
  })
})

describe('GET /api/jobs', () => {
  it('lists active jobs by due date and supports search', async () => {
    await createJob(manager, { clientName: 'Later Homes', dueDate: addWorkingDays(today(), 12) })
    await createJob(manager, { clientName: 'Sooner Builders', dueDate: addWorkingDays(today(), 3) })
    const all = await api().get('/api/jobs').set(bearer(manager))
    expect(all.body.map((j: { clientName: string }) => j.clientName)).toEqual(['Sooner Builders', 'Later Homes'])

    const search = await api().get('/api/jobs?q=later').set(bearer(manager))
    expect(search.body).toHaveLength(1)
    expect(search.body[0].clientName).toBe('Later Homes')
  })

  it('treats LIKE wildcards in searches as plain text', async () => {
    await createJob(manager, { clientName: 'Plain Name' })
    const res = await api().get('/api/jobs?q=%25').set(bearer(manager)) // q = "%"
    expect(res.body).toHaveLength(0)
  })

  it('validates query parameters', async () => {
    const res = await api().get('/api/jobs?stage=painting').set(bearer(manager))
    expect(res.status).toBe(422)
  })
})

describe('GET/PATCH /api/jobs/:id', () => {
  it('returns 404 for a job that does not exist and 422 for a bad id', async () => {
    expect((await api().get('/api/jobs/999').set(bearer(manager))).status).toBe(404)
    expect((await api().get('/api/jobs/abc').set(bearer(manager))).status).toBe(422)
  })

  it('updates the due date and notes, and clears notes with an empty string', async () => {
    const id = await createJob(manager, { notes: 'Call first' })
    const newDate = addWorkingDays(today(), 15)
    const updated = await api().patch(`/api/jobs/${id}`).set(bearer(manager)).send({ dueDate: newDate, priority: 'urgent' })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ dueDate: newDate, priority: 'urgent', notes: 'Call first' })

    const cleared = await api().patch(`/api/jobs/${id}`).set(bearer(manager)).send({ notes: '' })
    expect(cleared.body.notes).toBeNull()
  })

  it('rejects an empty update', async () => {
    const id = await createJob(manager)
    const res = await api().patch(`/api/jobs/${id}`).set(bearer(manager)).send({})
    expect(res.status).toBe(422)
  })
})
