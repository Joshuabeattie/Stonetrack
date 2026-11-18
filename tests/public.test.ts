import { beforeEach, describe, expect, it } from 'vitest'
import { advance, api, bearer, createJob, resetDatabase, tokenFor } from './helpers'

let manager: string

beforeEach(async () => {
  await resetDatabase()
  manager = await tokenFor('manager')
})

async function shareToken(id: number): Promise<string> {
  return (await api().get(`/api/jobs/${id}`).set(bearer(manager))).body.shareToken
}

describe('GET /api/public/jobs/:token (client portal)', () => {
  it('shows progress without signing in', async () => {
    const id = await createJob(manager, { notes: 'Internal: client is difficult' })
    await advance(manager, id, 2)
    const res = await api().get(`/api/public/jobs/${await shareToken(id)}`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ jobNumber: 'J-1001', clientName: 'Test Kitchens', stage: 'finishing', partCount: 1 })
    expect(res.body.timeline.map((t: { state: string }) => t.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'])
    expect(res.body.timeline[0].reachedAt).not.toBeNull()
    expect(res.body.timeline[3].reachedAt).toBeNull()
  })

  it('never exposes internal details', async () => {
    const id = await createJob(manager, { notes: 'Internal: client is difficult', siteAddress: '1 Secret St' })
    const res = await api().get(`/api/public/jobs/${await shareToken(id)}`)
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('Internal')
    expect(text).not.toContain('Secret St')
    for (const key of ['id', 'notes', 'siteAddress', 'shareToken', 'events', 'slabs', 'cuttingList']) {
      expect(res.body).not.toHaveProperty(key)
    }
  })

  it('returns 404 for unknown or malformed tokens', async () => {
    expect((await api().get('/api/public/jobs/AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404)
    expect((await api().get('/api/public/jobs/not%20a%20token')).status).toBe(404)
  })

  it('stops working when the link is regenerated', async () => {
    const id = await createJob(manager)
    const oldToken = await shareToken(id)
    const res = await api().post(`/api/jobs/${id}/share-token`).set(bearer(manager))
    expect(res.status).toBe(200)
    expect(res.body.shareToken).not.toBe(oldToken)
    expect((await api().get(`/api/public/jobs/${oldToken}`)).status).toBe(404)
    expect((await api().get(`/api/public/jobs/${res.body.shareToken}`)).status).toBe(200)
  })
})
