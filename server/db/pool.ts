// The PostgreSQL connection pool and two helpers: `query` and `withTransaction`.
import pg from 'pg'
import { config } from '../config'
import { logger } from '../logger'

// node-postgres turns some column types into awkward JavaScript values by default:
//  - DATE becomes a JS Date at local midnight, which shifts a day in some time zones.
//    Keep it as the 'YYYY-MM-DD' string instead.
//  - NUMERIC and BIGINT (e.g. count(*)) arrive as strings. Our values are small, so parse them.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number.parseFloat(value))
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10))

/** Anything we can run a query on: the pool, or one client inside a transaction. */
export type Db = Pick<pg.Pool, 'query'>

function sslOption(): pg.PoolConfig['ssl'] {
  switch (config.databaseSsl) {
    case 'disable':
      return false
    case 'verify':
      return { rejectUnauthorized: true }
    case 'require':
      // Replit's documented setting for its production database: encrypted, certificate not verified.
      return { rejectUnauthorized: false }
  }
}

function createPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. On Replit, open Tools → Database to make sure the app has a database; ' +
        'locally, copy .env.example to .env and point it at your PostgreSQL server.',
    )
  }
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: sslOption(),
    max: config.isProduction ? 10 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  // An idle connection can be closed by the server (databases sleep when unused).
  // Without this handler that error would crash the whole Node process.
  pool.on('error', (err) => logger.warn('Idle database connection closed', { error: err.message }))
  return pool
}

let pool: pg.Pool | undefined

/** The shared pool, created on first use so importing this file never needs a database. */
export function getPool(): pg.Pool {
  pool ??= createPool()
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool
    pool = undefined
    await current.end()
  }
}

/** Runs a query and returns the rows. `text` uses $1, $2… placeholders, never string concatenation. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const result = await db.query<T>(text, params)
  return result.rows
}

/**
 * Runs `work` inside a transaction: either everything it does is saved (COMMIT)
 * or, if it throws, nothing is (ROLLBACK).
 */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
