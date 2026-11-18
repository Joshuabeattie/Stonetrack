// The startup path that runs on every server instance: migrations and first-time
// seeding, including several instances starting at the same moment.
import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readMigrationFiles, pendingMigrations, runMigrations } from '../server/db/migrate'
import { closePool } from '../server/db/pool'
import { seedIfEmpty } from '../server/db/seed'
import { baseDatabaseUrl, testSsl } from './testDb'

// A separate, empty schema, so these tests start from a brand-new database.
const SCHEMA = 'stonetrack_test_startup'
const pools: pg.Pool[] = []

function freshPool(): pg.Pool {
  const url = new URL(baseDatabaseUrl())
  url.searchParams.set('options', `-c search_path=${SCHEMA}`)
  const pool = new pg.Pool({ connectionString: url.toString(), ssl: testSsl(), max: 2 })
  pools.push(pool)
  return pool
}

async function adminQuery(sql: string) {
  const client = new pg.Client({ connectionString: baseDatabaseUrl(), ssl: testSsl() })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

/** seedIfEmpty inside its own transaction, as the servers run it. */
async function seedInTransaction(pool: pg.Pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const summary = await seedIfEmpty(client)
    await client.query('COMMIT')
    return summary
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

beforeEach(async () => {
  await adminQuery(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`)
})

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()))
  await closePool()
  await adminQuery(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
})

describe('migrations', () => {
  it('applies every file once, then does nothing on the next start', async () => {
    const files = (await readMigrationFiles()).map((m) => m.name)
    const pool = freshPool()
    expect(await pendingMigrations(pool)).toEqual(files)
    expect(await runMigrations(pool)).toEqual(files)
    expect(await pendingMigrations(pool)).toEqual([])
    expect(await runMigrations(pool)).toEqual([])
  })

  it('applies each file exactly once when three instances start together', async () => {
    const files = (await readMigrationFiles()).map((m) => m.name)
    const results = await Promise.all([runMigrations(freshPool()), runMigrations(freshPool()), runMigrations(freshPool())])
    expect(results.flat().sort()).toEqual(files)
    const { rows } = await freshPool().query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations')
    expect(rows[0].n).toBe(files.length)
  })

  it('accepts migrations passed in as text (how the Cloudflare Worker supplies them)', async () => {
    const pool = freshPool()
    const applied = await runMigrations(pool, () => {}, [{ name: '001_only.sql', sql: 'CREATE TABLE only_table (id int)' }])
    expect(applied).toEqual(['001_only.sql'])
    await expect(pool.query('SELECT * FROM only_table')).resolves.toBeDefined()
  })

  it('rolls back a failing migration completely and says which file failed', async () => {
    const pool = freshPool()
    const broken = [{ name: '001_broken.sql', sql: 'CREATE TABLE half_done (id int); SELECT no_such_column FROM half_done' }]
    await expect(runMigrations(pool, () => {}, broken)).rejects.toThrow('Migration 001_broken.sql failed')
    const { rows } = await pool.query("SELECT to_regclass('half_done') AS t")
    expect(rows[0].t).toBeNull()
    expect(await pendingMigrations(pool, broken)).toEqual(['001_broken.sql'])
  })
})

describe('first-time seeding', () => {
  it('loads the demo data once when two instances start together', async () => {
    await runMigrations(freshPool())
    const [a, b] = await Promise.all([seedInTransaction(freshPool()), seedInTransaction(freshPool())])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    const { rows } = await freshPool().query<{ users: number; jobs: number }>(
      'SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM jobs) AS jobs',
    )
    expect(rows[0]).toEqual({ users: 3, jobs: 40 })
    expect(await seedInTransaction(freshPool())).toBeNull()
  })
})
