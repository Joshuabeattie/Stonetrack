// Builds the Express application. Kept separate from index.ts (which starts the
// server) so the tests can create an app and send requests to it without a real port.
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import { config } from './config'
import { HttpError } from './http/errors'
import { errorHandler, requestContext } from './http/middleware'
import { webhookLimiter } from './http/rateLimits'
import { apiRouter } from './routes'
import { receiveOrderWebhook } from './routes/webhooks'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  // Replit runs the app behind one proxy. This makes req.ip the real client address (used by rate limits).
  app.set('trust proxy', 1)

  app.use(requestContext)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Allow the QR code image (a data: URL) on the dispatch docket.
          'img-src': ["'self'", 'data:'],
          // Don't force https: so `npm start` also works on http://localhost.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  )

  // The order webhook needs the raw request body to check its signature,
  // so it is registered before the JSON parser below.
  app.post('/api/webhooks/orders', webhookLimiter, express.raw({ type: () => true, limit: '256kb' }), receiveOrderWebhook)

  app.use(express.json({ limit: '200kb' }))
  app.use('/api', apiRouter())
  app.use('/api', (req, _res, next) => next(new HttpError(404, 'NOT_FOUND', `No API route for ${req.method} ${req.originalUrl.split('?')[0]}`)))

  if (config.serveClient) serveClient(app)

  app.use(errorHandler)
  return app
}

/** Production only: serve the built React app, and send index.html for any other page URL. */
function serveClient(app: express.Express) {
  const dir = path.resolve(process.cwd(), config.clientDir)
  const indexHtml = path.join(dir, 'index.html')
  if (!existsSync(indexHtml)) {
    console.warn(`[stonetrack] ${indexHtml} not found. Run "npm run build" before "npm start".`)
    return
  }
  // Vite puts a content hash in asset filenames, so they can be cached for a year.
  app.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
  app.use(express.static(dir, { index: false, maxAge: '1h' }))
  // Client-side routes like /jobs/12 or /track/abc: let React Router handle them.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexHtml)
  })
}
