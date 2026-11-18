import { beforeEach, describe, expect, it } from 'vitest'
import { advance, api, bearer, createJob, resetDatabase, tokenFor } from './helpers'

let manager: string

beforeEach(async () => {
  await resetDatabase()
  manager = await tokenFor('manager')
})

describe('slab stock', () => {
  it('reports stock levels per stone with a low-stock flag', async () => {
    const res = await api().get('/api/slabs/stock').set(bearer(manager))
    expect(res.status).toBe(200)
    const byCode = Object.fromEntries(res.body.map((m: { code: string }) => [m.code, m]))
    expect(byCode['GRA-TST']).toMatchObject({ available: 3, allocated: 0, reorderLevel: 2, lowStock: false })
    expect(byCode['MAR-TST']).toMatchObject({ available: 1, reorderLevel: 1, lowStock: true }) // at the reorder level
  })

  it('receives a delivery at the stone’s standard slab size', async () => {
    const res = await api().post('/api/slabs').set(bearer(manager)).send({ materialId: 2, quantity: 2, rackLocation: 'C4' })
    expect(res.status).toBe(201)
    expect(res.body.map((s: { code: string }) => s.code)).toEqual(['SL-0005', 'SL-0006'])
    expect(res.body[0]).toMatchObject({ status: 'available', lengthMm: 2800, widthMm: 1700, rackLocation: 'C4', materialCode: 'MAR-TST' })
  })

  it('validates deliveries', async () => {
    const res = await api().post('/api/slabs').set(bearer(manager)).send({ materialId: 1, quantity: 0 })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].path).toBe('quantity')
  })

  it('filters the slab list by status', async () => {
    const id = await createJob(manager)
    await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({})
    const res = await api().get('/api/slabs?status=allocated').set(bearer(manager))
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ code: 'SL-0001', jobNumber: 'J-1001' })
  })
})

describe('allocation', () => {
  it('auto-allocates what the cutting list needs, then refuses to over-allocate', async () => {
    const id = await createJob(manager)
    const first = await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({})
    expect(first.status).toBe(200)
    expect(first.body.allocated).toEqual(['SL-0001'])
    const second = await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({})
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ALREADY_ALLOCATED')
  })

  it('allocates a specific slab, but only of the right stone and only if available', async () => {
    const id = await createJob(manager)
    const marble = await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({ slabIds: [4] })
    expect(marble.status).toBe(422)
    expect((await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({ slabIds: [3] })).status).toBe(200)
    const again = await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({ slabIds: [3] })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('SLAB_UNAVAILABLE')
  })

  it('releases an allocated slab back to stock, but not one that has been cut', async () => {
    const id = await createJob(manager)
    await api().post(`/api/jobs/${id}/allocate`).set(bearer(manager)).send({})
    const released = await api().post('/api/slabs/1/release').set(bearer(manager))
    expect(released.status).toBe(200)
    expect(released.body).toMatchObject({ status: 'available', jobId: null })

    await advance(manager, id, 2) // allocates again, cuts → consumed
    const consumedSlab = (await api().get(`/api/jobs/${id}`).set(bearer(manager))).body.slabs[0]
    expect(consumedSlab.status).toBe('consumed')
    const refused = await api().post(`/api/slabs/${consumedSlab.id}/release`).set(bearer(manager))
    expect(refused.status).toBe(409)
  })
})
