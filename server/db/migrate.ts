// A minimal migration runner.
//
// Migrations are plain .sql files in server/db/migrations, applied in filename order
// (001_…, 002_…). The schema_migrations table remembers which files have run, so each
// file runs once per database. Each file runs inside a transaction: it either applies
// completely or not at all.
//
// On Node the files are read from disk. A Cloudflare Worker can't read the project
// folder, so cloudflare/migrations.ts bundles the same files as text and passes them in.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { config } from '../config'

// Any fixed number works; it just has to be the same for every server instance.
// Holding this lock means two instances starting at once can't both run a migration.
const MIGRATION_LOCK_ID = 74_210_001

/** One migration: its filename (the id stored in schema_migrations) and its SQL. */
export interface Migration {
  name: string
  sql: string
}

export function migrationsDir(): string {
  return path.resolve(process.cwd(), config.migrationsDir)
}

/** Reads every .sql file in the migrations folder, in filename order. */
export async function readMigrationFiles(): Promise<Migration[]> {
  const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(migrationsDir(), name), 'utf8') })))
}

/** Filenames already applied. An empty set if schema_migrations doesn't exist yet. */
async function appliedMigrations(db: pg.Pool | pg.ClientBase): Promise<Set<string>> {
  try {
    const { rows } = await db.query<{ filename: string }>('SELECT filename FROM schema_migrations')
    return new Set(rows.map((r) => r.filename))
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return new Set() // undefined_table: a brand-new database
    throw err
  }
}

/** Names of migrations that haven't been applied to this database yet. `migrations` defaults to the files on disk. */
export async function pendingMigrations(pool: pg.Pool, migrations?: Migration[]): Promise<string[]> {
  const all = migrations ?? (await readMigrationFiles())
  const done = await appliedMigrations(pool)
  return all.map((m) => m.name).filter((name) => !done.has(name))
}

/**
 * Applies every migration that hasn't run yet and returns their names.
 * `migrations` defaults to the files on disk.
 */
export async function runMigrations(
  pool: pg.Pool,
  log: (message: string) => void = () => {},
  migrations?: Migration[],
): Promise<string[]> {
  const all = migrations ?? (await readMigrationFiles())
  // The usual case is "nothing to do": one quick query, no lock.
  const pending = new Set(await pendingMigrations(pool, all))
  if (pending.size === 0) return []

  const client = await pool.connect()
  const applied: string[] = []
  try {
    for (const { name, sql } of all.filter((m) => pending.has(m.name))) {
      let ran = false
      try {
        await client.query('BEGIN')
        // Wait here while another server instance applies migrations. This is a
        // transaction-level lock, released by COMMIT or ROLLBACK. (A session-level lock
        // would outlive the transaction behind a connection pooler such as Cloudflare's
        // Hyperdrive, and block every other client.)
        await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID])
        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
          )`)
        // Check again under the lock: another instance may have applied it while we waited.
        const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [name])
        if (rowCount === 0) {
          await client.query(sql)
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [name])
          ran = true
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`)
      }
      if (ran) {
        applied.push(name)
        log(`Applied migration ${name}`)
      }
    }
    return applied
  } finally {
    client.release()
  }
}
