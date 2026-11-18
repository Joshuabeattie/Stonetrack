// Admin view of the order webhook: how to call it, a test button, and the delivery log.
import { useState } from 'react'
import { Link } from 'react-router'
import type { WebhookEventRecord } from '../../../shared/types'
import { api, ApiError } from '../api'
import { Empty, ErrorNotice, Loading } from '../components/Feedback'
import { PageHeader } from '../components/Layout'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

interface Example {
  endpoint: string
  headers: string[]
  payload: Record<string, unknown>
}

const STATUS_TEXT = { created: 'Job created', duplicate: 'Already received', rejected: 'Rejected' } as const

export function IntegrationsPage() {
  useDocumentTitle('Integrations')
  const toast = useToast()
  const example = useApi<Example>('/webhooks/example')
  const events = useApi<WebhookEventRecord[]>('/webhooks/events')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const endpoint = `${window.location.origin}/api/webhooks/orders`

  async function sendTest() {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ jobNumber: string }>('/webhooks/test', { method: 'POST' })
      toast(`Test order received as ${res.jobNumber}`)
      events.reload()
    } catch (err) {
      setError(err as ApiError)
      events.reload()
    } finally {
      setBusy(false)
    }
  }

  const body = example.data ? JSON.stringify(example.data.payload, null, 2) : ''
  const curl = `BODY='${JSON.stringify(example.data?.payload ?? {})}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-StoneTrack-Timestamp: $TS" \\
  -H "X-StoneTrack-Signature: sha256=$SIG" \\
  --data "$BODY"`

  return (
    <>
      <PageHeader title="Integrations" sub="Other systems, such as a quoting portal, can send new orders straight into StoneTrack." />

      <section className="section prose" aria-labelledby="webhook-heading">
        <h2 id="webhook-heading" className="section-title">
          New order webhook
        </h2>
        <p>
          Send a <code>POST</code> to <code>{endpoint}</code> with the order as JSON. Sign it with the shared secret (<code>WEBHOOK_SECRET</code>): the{' '}
          <code>X-StoneTrack-Signature</code> header is <code>sha256=</code> followed by the hex HMAC-SHA256 of the timestamp, a full stop, and the raw body.
          Requests more than five minutes old are refused.
        </p>
        <p>
          Sending the same <code>externalRef</code> again returns the job that already exists, so the sender can safely retry. A new job answers{' '}
          <code>201</code>, a repeat answers <code>200</code>, a bad signature <code>401</code> and invalid data <code>422</code> with the reasons.
        </p>
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void sendTest()}>
            {busy ? 'Sending' : 'Send a test order'}
          </button>
          <span className="muted">Signs an example order with this server's secret and runs it through the real webhook code.</span>
        </div>
        {error && <ErrorNotice error={error} />}
        {example.data && (
          <div className="code-pair">
            <div>
              <h3>Example body</h3>
              <pre className="code-block">{body}</pre>
            </div>
            <div>
              <h3>Example call with curl</h3>
              <pre className="code-block">{curl}</pre>
            </div>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="log-heading">
        <h2 id="log-heading" className="section-title">
          Recent deliveries
        </h2>
        {events.error && <ErrorNotice error={events.error} onRetry={events.reload} />}
        {!events.data && events.loading && <Loading />}
        {events.data && events.data.length === 0 && <Empty title="No deliveries yet" />}
        {events.data && events.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Order ref</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="num">
                    HTTP
                  </th>
                  <th scope="col">Job</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Received">{formatDateTime(e.receivedAt)}</td>
                    <td data-label="Order ref" className="code">
                      {e.externalRef ?? ''}
                    </td>
                    <td data-label="Result">
                      <span className={`delivery delivery-${e.status}`}>{STATUS_TEXT[e.status]}</span>
                    </td>
                    <td data-label="HTTP" className="num">
                      {e.httpStatus}
                    </td>
                    <td data-label="Job">{e.jobId ? <Link to={`/jobs/${e.jobId}`}>{e.jobNumber}</Link> : ''}</td>
                    <td data-label="Reason">{e.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
