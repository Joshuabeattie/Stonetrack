// Starts the server: check the database, apply migrations (production), seed an
// empty demo database (production + demo mode), then listen for requests.
import { createApp } from './app'
import { config } from './config'
import { pendingMigrations, runMigrations } from './db/migrate'
import { closePool, getPool, withTransaction } from './db/pool'
import { isDatabaseEmpty, seedIfEmpty } from './db/seed'
import { logger } from './logger'

async function prepareDatabase() {
  const pool = getPool()
  if (config.runMigrationsOnStart) {
    await runMigrations(pool, (message) => logger.info(message))
    if (config.demoMode) {
      const summary = await withTransaction((client) => seedIfEmpty(client))
      if (summary) logger.info('Empty database: loaded demo data', { ...summary })
    }
    return
  }
  // Development: don't change the database behind your back, but say clearly what's missing.
  try {
    const pending = await pendingMigrations(pool)
    if (pending.length > 0) {
      logger.warn(`Database needs setting up: ${pending.length} migration(s) pending. Run: npm run db:setup`)
    } else if (await isDatabaseEmpty(pool)) {
      logger.warn('Database has no data yet. Run: npm run db:seed')
    }
  } catch (err) {
    logger.error('Could not reach the database. Check DATABASE_URL.', { error: err })
  }
}

async function start() {
  await prepareDatabase()
  const app = createApp()
  const server = app.listen(config.port, config.host, () => {
    logger.info(`StoneTrack API listening on http://${config.host}:${config.port} (${config.env})`)
  })

  // Replit (and most hosts) send SIGTERM before stopping the app: finish requests, close the pool.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`)
    server.close(() => {
      closePool().finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch((err) => {
  logger.error('StoneTrack failed to start', { error: err })
  process.exit(1)
})
