// Entry point for the staging site on Cloudflare Workers (configured in wrangler.jsonc).
//
// It runs the same Express app as Replit does. Cloudflare's Node.js compatibility
// layer hands each request to Express as a normal Node request (handleAsNodeRequest)
// and turns Express's reply back into a Workers Response. Static files never reach
// this code: Cloudflare serves the React build from dist/client itself, and only
// /api/* requests run the Worker.
//
// Two things differ from a long-running Node server:
//  1. A database connection can't be reused by a later request, so every request gets
//     its own small pool (Hyperdrive keeps the real connections to Neon warm).
//  2. There's no "startup" step, so the first request each Worker instance handles
//     applies migrations and, on an empty database, loads the demo data.
import { handleAsNodeRequest } from 'cloudflare:node'
import type { Server } from 'node:http'
import { createApp } from '../server/app'
import { config } from '../server/config'
import { runMigrations } from '../server/db/migrate'
import { createRequestPool, getPool, runWithPool, withTransaction } from '../server/db/pool'
import { isDatabaseEmpty, seedDemoData, seedIfEmpty } from '../server/db/seed'
import { logger } from '../server/logger'
import { bundledMigrations } from './migrations'

export interface Env {
  HYPERDRIVE: Hyperdrive // the binding to the Neon database, set up in wrangler.jsonc
}

// The port is only a name for Express's in-memory server: nothing listens on a real socket.
const PORT = 8080

let server: Server | undefined
let databaseReady = false

function expressServer(): Server {
  server ??= createApp().listen(PORT)
  return server
}

/**
 * Once per Worker instance: apply new migrations, then load the demo data if the
 * database is empty. When everything is already in place this is two quick queries.
 */
async function prepareDatabase(): Promise<void> {
  if (databaseReady) return
  await runMigrations(getPool(), (message) => logger.info(message), bundledMigrations)
  if (config.demoMode && (await isDatabaseEmpty(getPool()))) {
    const summary = await withTransaction((client) => seedIfEmpty(client))
    if (summary) logger.info('Empty database: loaded demo data', { ...summary })
  }
  databaseReady = true
}

/** The API's usual error shape, for the case where the database can't be reached at all. */
function databaseUnavailable(err: unknown): Response {
  logger.error('Database unavailable', { error: err })
  const message = 'The database is not reachable right now. Try again in a minute.'
  return Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message } }, { status: 503 })
}

export default {
  async fetch(request, env, ctx) {
    const pool = createRequestPool(env.HYPERDRIVE.connectionString)
    try {
      return await runWithPool(pool, async () => {
        try {
          await prepareDatabase()
        } catch (err) {
          return databaseUnavailable(err)
        }
        expressServer()
        return handleAsNodeRequest(PORT, request, env, ctx)
      })
    } finally {
      // Close this request's connections once the response is on its way.
      ctx.waitUntil(pool.end())
    }
  },

  // Cron trigger (see wrangler.jsonc): put the demo data back every night, so the
  // dates stay current and visitors' changes from the day before are cleared.
  async scheduled(_controller, env, ctx) {
    if (!config.demoMode) return
    const pool = createRequestPool(env.HYPERDRIVE.connectionString)
    try {
      await runWithPool(pool, async () => {
        await prepareDatabase()
        const summary = await withTransaction((client) => seedDemoData(client))
        logger.info('Nightly demo reset', { ...summary })
      })
    } finally {
      ctx.waitUntil(pool.end())
    }
  },
} satisfies ExportedHandler<Env>
