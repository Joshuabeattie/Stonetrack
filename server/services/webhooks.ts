// The order webhook: another system (say, a quoting tool) POSTs a new order as JSON.
//
// Security: the sender signs each request with a shared secret (WEBHOOK_SECRET):
//   X-StoneTrack-Timestamp: <unix seconds>
//   X-StoneTrack-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
// We recompute the HMAC and compare in constant time. Including the timestamp, and
// rejecting old timestamps, stops someone replaying a captured request later.
//
// Safe retries: `externalRef` is the sender's order number and is unique in our jobs
// table. Sending the same order twice returns the existing job (200) instead of a duplicate.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { addWorkingDays } from '../../shared/dates'
import { webhookOrderSchema, type WebhookOrder } from '../../shared/schemas'
import type { WebhookEventRecord } from '../../shared/types'
import { config } from '../config'
import { query } from '../db/pool'
import { HttpError, validationError, type FieldIssue } from '../http/errors'
import { parse } from '../http/validate'
import { logger } from '../logger'
import { createJob, factoryToday } from './jobs'
import { getMaterialByCode } from './reference'

export const SIGNATURE_HEADER = 'x-stonetrack-signature'
export const TIMESTAMP_HEADER = 'x-stonetrack-timestamp'

export function signPayload(secret: string, timestamp: string | number, rawBody: string | Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')
}

export function verifySignature(input: {
  secret: string
  timestamp: string | undefined
  signature: string | undefined
  rawBody: Buffer
  toleranceSeconds: number
  nowSeconds?: number
}): { ok: true } | { ok: false; reason: string } {
  const { timestamp, signature } = input
  if (!timestamp || !signature) return { ok: false, reason: 'Missing X-StoneTrack-Timestamp or X-StoneTrack-Signature header' }
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: 'X-StoneTrack-Timestamp must be a Unix time in seconds' }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(timestamp)) > input.toleranceSeconds) {
    return { ok: false, reason: 'Timestamp is more than 5 minutes old or in the future' }
  }
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'X-StoneTrack-Signature must look like sha256=<64 hex characters>' }
  const expected = Buffer.from(signPayload(input.secret, timestamp, input.rawBody))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return { ok: false, reason: 'Signature does not match' }
  return { ok: true }
}

async function logDelivery(entry: { externalRef?: string | null; status: 'created' | 'duplicate' | 'rejected'; httpStatus: number; jobId?: number | null; error?: string | null }) {
  try {
    await query('INSERT INTO webhook_events (external_ref, status, http_status, job_id, error) VALUES ($1, $2, $3, $4, $5)', [
      entry.externalRef ?? null,
      entry.status,
      entry.httpStatus,
      entry.jobId ?? null,
      entry.error ?? null,
    ])
  } catch (err) {
    // Logging must never break the webhook itself.
    logger.warn('Could not record webhook delivery', { error: err })
  }
}

const summarise = (details: FieldIssue[] | undefined) => (details ?? []).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')

export interface WebhookResult {
  status: 200 | 201
  body: { jobId: number; jobNumber: string; duplicate: boolean; trackingUrl: string }
}

async function findByExternalRef(externalRef: string) {
  const rows = await query<{ id: number; job_number: string; share_token: string }>(
    'SELECT id, job_number, share_token FROM jobs WHERE external_ref = $1',
    [externalRef],
  )
  return rows[0] ?? null
}

/** Verifies, validates and records one webhook call. `origin` builds the tracking link (e.g. https://app.example). */
export async function receiveOrder(
  rawBody: Buffer,
  headers: { timestamp?: string; signature?: string },
  origin: string,
): Promise<WebhookResult> {
  const check = verifySignature({
    secret: config.webhookSecret,
    timestamp: headers.timestamp,
    signature: headers.signature,
    rawBody,
    toleranceSeconds: config.webhookToleranceSeconds,
  })
  if (!check.ok) {
    await logDelivery({ status: 'rejected', httpStatus: 401, error: check.reason })
    throw new HttpError(401, 'INVALID_SIGNATURE', check.reason)
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody.toString('utf8'))
  } catch {
    await logDelivery({ status: 'rejected', httpStatus: 400, error: 'Body is not valid JSON' })
    throw new HttpError(400, 'BAD_REQUEST', 'The request body is not valid JSON')
  }
  const externalRef = typeof (json as { externalRef?: unknown })?.externalRef === 'string' ? (json as { externalRef: string }).externalRef : null

  let order: WebhookOrder
  try {
    order = parse(webhookOrderSchema, json)
  } catch (err) {
    await logDelivery({ externalRef, status: 'rejected', httpStatus: 422, error: summarise((err as HttpError).details) })
    throw err
  }

  const trackingUrl = (token: string) => `${origin}/track/${token}`
  const existing = await findByExternalRef(order.externalRef)
  if (existing) {
    await logDelivery({ externalRef: order.externalRef, status: 'duplicate', httpStatus: 200, jobId: existing.id })
    return { status: 200, body: { jobId: existing.id, jobNumber: existing.job_number, duplicate: true, trackingUrl: trackingUrl(existing.share_token) } }
  }

  try {
    const material = await getMaterialByCode(order.materialCode)
    if (!material) throw validationError([{ path: 'materialCode', message: `Unknown stone code "${order.materialCode}"` }])
    const jobId = await createJob(
      {
        clientName: order.client.name,
        clientEmail: order.client.email,
        clientPhone: order.client.phone,
        siteAddress: order.siteAddress,
        drawingRef: order.drawingRef,
        materialId: material.id,
        dueDate: order.dueDate,
        priority: order.priority,
        notes: order.notes,
        pieces: order.pieces,
      },
      { source: 'webhook', externalRef: order.externalRef },
    )
    const created = (await findByExternalRef(order.externalRef))!
    await logDelivery({ externalRef: order.externalRef, status: 'created', httpStatus: 201, jobId })
    return { status: 201, body: { jobId, jobNumber: created.job_number, duplicate: false, trackingUrl: trackingUrl(created.share_token) } }
  } catch (err) {
    // Two identical deliveries racing each other: the second hits the unique external_ref.
    if ((err as { code?: string }).code === '23505') {
      const raced = await findByExternalRef(order.externalRef)
      if (raced) {
        await logDelivery({ externalRef: order.externalRef, status: 'duplicate', httpStatus: 200, jobId: raced.id })
        return { status: 200, body: { jobId: raced.id, jobNumber: raced.job_number, duplicate: true, trackingUrl: trackingUrl(raced.share_token) } }
      }
    }
    if (err instanceof HttpError) await logDelivery({ externalRef: order.externalRef, status: 'rejected', httpStatus: err.status, error: err.details ? summarise(err.details) : err.message })
    throw err
  }
}

export async function listWebhookEvents(limit = 50): Promise<WebhookEventRecord[]> {
  const rows = await query<{
    id: number
    received_at: Date
    external_ref: string | null
    status: WebhookEventRecord['status']
    http_status: number
    job_id: number | null
    job_number: string | null
    error: string | null
  }>(
    `SELECT w.id, w.received_at, w.external_ref, w.status, w.http_status, w.job_id, j.job_number, w.error
       FROM webhook_events w LEFT JOIN jobs j ON j.id = w.job_id
      ORDER BY w.received_at DESC, w.id DESC
      LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.received_at.toISOString(),
    externalRef: r.external_ref,
    status: r.status,
    httpStatus: r.http_status,
    jobId: r.job_id,
    jobNumber: r.job_number,
    error: r.error,
  }))
}

/** A valid example order with a fresh reference and a due date ten working days out. */
export function exampleOrder(): WebhookOrder {
  return {
    externalRef: `QP-${String(Date.now()).slice(-6)}`,
    client: { name: 'Larkspur Lane Kitchens', email: 'design@larkspurlane.example', phone: '03 5550 0110' },
    siteAddress: '27 Bellbird Way, Fernleigh VIC',
    drawingRef: 'QP-DWG-0931 Rev A',
    materialCode: 'POR-ASH',
    dueDate: addWorkingDays(factoryToday(), 10),
    priority: 'normal',
    notes: 'Sent from the quoting portal.',
    pieces: [
      { name: 'Main bench', lengthMm: 2650, widthMm: 650, quantity: 1, edgeProfile: 'pencil_round', polishedEdges: ['front'], cutouts: 2 },
      { name: 'Splashback', lengthMm: 2100, widthMm: 650, quantity: 1, edgeProfile: 'arris', polishedEdges: [], cutouts: 0 },
    ],
  }
}
