import { beforeEach, describe, expect, it } from 'vitest'
import { config } from '../server/config'
import { signPayload, verifySignature } from '../server/services/webhooks'
import { api, bearer, resetDatabase, tokenFor, workingDaysFromToday } from './helpers'

beforeEach(resetDatabase)

function order(overrides: Record<string, unknown> = {}) {
  return {
    externalRef: 'QP-1001',
    client: { name: 'Portal Kitchens', email: 'orders@portal.example' },
    drawingRef: 'QP-DWG-1',
    materialCode: 'gra-tst', // codes are matched case-insensitively
    dueDate: workingDaysFromToday(10),
    pieces: [{ name: 'Bench', lengthMm: 2000, widthMm: 600, quantity: 1, edgeProfile: 'pencil_round', polishedEdges: ['front'], cutouts: 1 }],
    ...overrides,
  }
}

/** Sends a signed webhook exactly as a real sender would. */
function send(body: unknown, options: { secret?: string; timestamp?: number } = {}) {
  const raw = JSON.stringify(body)
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  return api()
    .post('/api/webhooks/orders')
    .set('Content-Type', 'application/json')
    .set('X-StoneTrack-Timestamp', timestamp)
    .set('X-StoneTrack-Signature', signPayload(options.secret ?? config.webhookSecret, timestamp, raw))
    .send(raw)
}

describe('POST /api/webhooks/orders', () => {
  it('creates a job from a correctly signed order', async () => {
    const res = await send(order())
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ jobNumber: 'J-1001', duplicate: false })
    expect(res.body.trackingUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/track\/[A-Za-z0-9_-]{24}$/)

    const manager = await tokenFor('manager')
    const job = (await api().get(`/api/jobs/${res.body.jobId}`).set(bearer(manager))).body
    expect(job).toMatchObject({ source: 'webhook', externalRef: 'QP-1001', clientName: 'Portal Kitchens', materialCode: 'GRA-TST' })
    expect(job.events[0].note).toContain('QP-1001')
  })

  it('is idempotent: the same order twice returns the same job with 200', async () => {
    const first = await send(order())
    const second = await send(order())
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ jobId: first.body.jobId, duplicate: true })
  })

  it('rejects a wrong signature with 401', async () => {
    const res = await send(order(), { secret: 'not-the-secret' })
    expect(res.status).toBe(401)
    expect(res.body.error).toMatchObject({ code: 'INVALID_SIGNATURE', message: 'Signature does not match' })
  })

  it('rejects a request that was changed after signing', async () => {
    const raw = JSON.stringify(order())
    const timestamp = String(Math.floor(Date.now() / 1000))
    const res = await api()
      .post('/api/webhooks/orders')
      .set('Content-Type', 'application/json')
      .set('X-StoneTrack-Timestamp', timestamp)
      .set('X-StoneTrack-Signature', signPayload(config.webhookSecret, timestamp, raw))
      .send(raw.replace('Portal Kitchens', 'Evil Kitchens'))
    expect(res.status).toBe(401)
  })

  it('rejects an old timestamp (replay protection)', async () => {
    const res = await send(order(), { timestamp: Math.floor(Date.now() / 1000) - 600 })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toContain('5 minutes')
  })

  it('rejects missing signature headers', async () => {
    const res = await api().post('/api/webhooks/orders').set('Content-Type', 'application/json').send(JSON.stringify(order()))
    expect(res.status).toBe(401)
  })

  it('validates the payload and an unknown stone code', async () => {
    const missing = await send(order({ pieces: [] }))
    expect(missing.status).toBe(422)
    const unknownStone = await send(order({ materialCode: 'NOPE-1' }))
    expect(unknownStone.status).toBe(422)
    expect(unknownStone.body.error.details[0]).toMatchObject({ path: 'materialCode' })
  })

  it('logs every delivery for the Integrations page (admin only)', async () => {
    await send(order())
    await send(order())
    await send(order(), { secret: 'wrong' })
    const admin = await tokenFor('admin')
    const res = await api().get('/api/webhooks/events').set(bearer(admin))
    expect(res.body.map((e: { status: string; httpStatus: number }) => [e.status, e.httpStatus])).toEqual([
      ['rejected', 401],
      ['duplicate', 200],
      ['created', 201],
    ])
    expect((await api().get('/api/webhooks/events').set(bearer(await tokenFor('manager')))).status).toBe(403)
  })

  it('POST /api/webhooks/test runs a signed example order through the same code', async () => {
    const admin = await tokenFor('admin')
    // The example uses POR-ASH, which the small test data set doesn't have: expect a clear 422.
    const res = await api().post('/api/webhooks/test').set(bearer(admin))
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].message).toContain('POR-ASH')
  })
})

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}')
  const now = 1_800_000_000
  const sign = (ts: number) => signPayload('secret', ts, body)

  it('accepts a fresh, matching signature', () => {
    expect(verifySignature({ secret: 'secret', timestamp: String(now), signature: sign(now), rawBody: body, toleranceSeconds: 300, nowSeconds: now + 10 })).toEqual({ ok: true })
  })

  it('rejects timestamps outside the tolerance in either direction', () => {
    for (const offset of [-301, 301]) {
      const result = verifySignature({ secret: 'secret', timestamp: String(now), signature: sign(now), rawBody: body, toleranceSeconds: 300, nowSeconds: now + offset })
      expect(result.ok).toBe(false)
    }
  })

  it('rejects malformed signatures without throwing', () => {
    const result = verifySignature({ secret: 'secret', timestamp: String(now), signature: 'sha256=zz', rawBody: body, toleranceSeconds: 300, nowSeconds: now })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('sha256=') })
  })
})
