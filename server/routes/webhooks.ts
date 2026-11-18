import { Router, type RequestHandler } from 'express'
import { requireRole } from '../auth/middleware'
import { config } from '../config'
import { exampleOrder, listWebhookEvents, receiveOrder, signPayload, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../services/webhooks'

const originOf = (req: Parameters<RequestHandler>[0]) => `${req.protocol}://${req.get('host')}`

// POST /api/webhooks/orders: registered in app.ts with a raw-body parser (the signature
// is checked against the exact bytes received). 201 = job created, 200 = already had it.
export const receiveOrderWebhook: RequestHandler = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const result = await receiveOrder(
    rawBody,
    { timestamp: req.get(TIMESTAMP_HEADER), signature: req.get(SIGNATURE_HEADER) },
    originOf(req),
  )
  res.status(result.status).json(result.body)
}

export const webhookAdminRoutes = Router()
webhookAdminRoutes.use(requireRole('admin'))

// GET /api/webhooks/events: the delivery log shown on the Integrations page.
webhookAdminRoutes.get('/events', async (_req, res) => {
  res.json(await listWebhookEvents())
})

// GET /api/webhooks/example: a valid payload to copy into your own test call.
webhookAdminRoutes.get('/example', (_req, res) => {
  res.json({ endpoint: '/api/webhooks/orders', headers: [TIMESTAMP_HEADER, SIGNATURE_HEADER], payload: exampleOrder() })
})

// POST /api/webhooks/test: signs an example order with the server's secret and runs it
// through exactly the same code path as a real delivery (the "Send test order" button).
webhookAdminRoutes.post('/test', async (req, res) => {
  const body = Buffer.from(JSON.stringify(exampleOrder()))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const result = await receiveOrder(body, { timestamp, signature: signPayload(config.webhookSecret, timestamp, body) }, originOf(req))
  res.status(result.status).json(result.body)
})
