// Sends docs/example-order.json to the order webhook, signed with WEBHOOK_SECRET.
//
//   npm run webhook:example                                   (to http://localhost:5000)
//   npm run webhook:example -- --url https://your-app.replit.app
//   npm run webhook:example -- --ref QP-30001                 (send twice: the second is a 200 duplicate)
//
// By default it uses a fresh order reference and a due date ten working days out,
// so every run creates a new job.
import 'dotenv/config'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { addWorkingDays, todayInZone } from '../shared/dates'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const baseUrl = (arg('--url') ?? process.env.STONETRACK_URL ?? 'http://localhost:5000').replace(/\/$/, '')
const secret = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret'

const order = JSON.parse(await readFile(new URL('../docs/example-order.json', import.meta.url), 'utf8'))
order.externalRef = arg('--ref') ?? `QP-${String(Date.now()).slice(-6)}`
order.dueDate = addWorkingDays(todayInZone(process.env.FACTORY_TIMEZONE ?? 'Australia/Melbourne'), 10)

const body = JSON.stringify(order)
const timestamp = String(Math.floor(Date.now() / 1000))
const signature = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

console.log(`POST ${baseUrl}/api/webhooks/orders  (order ${order.externalRef})`)
const res = await fetch(`${baseUrl}/api/webhooks/orders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-StoneTrack-Timestamp': timestamp,
    'X-StoneTrack-Signature': signature,
  },
  body,
})
console.log(`${res.status} ${res.statusText}`)
console.log(JSON.stringify(await res.json(), null, 2))
if (!res.ok) process.exitCode = 1
