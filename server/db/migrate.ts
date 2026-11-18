// A minimal migration runner.
//
// Migrations are plain .sql files in server/db/migrations, applied in filename order
// (001_…, 002_…). The schema_migrations table remembers which files have run, so each
// file runs once per database. Each file runs inside a transaction: it either applies
// completely or not at all.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { config } from '../config'

// Any fixed number works; it just has to be the same for every server instance.
// Holding this lock means two instances starting at once can't both run migrations.
const MIGRATION_LOCK_ID = 74_210_001

export function migrationsDir(): string {
  return path.resolve(process.cwd(), config.migrationsDir)
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDir())
  return files.filter((f) => f.endsWith('.sql')).sort()
}

async function appliedMigrations(client: pg.ClientBase): Promise<Set<string>> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
  const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')
  return new Set(rows.map((r) => r.filename))
}

/** Applies every migration that hasn't run yet. Returns the filenames it applied. */
export async function runMigrations(pool: pg.Pool, log: (message: string) => void = () => {}): Promise<string[]> {
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    const done = await appliedMigrations(client)
    for (const file of await listMigrationFiles()) {
      if (done.has(file)) continue
      const sql = await readFile(path.join(migrationsDir(), file), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
      applied.push(file)
      log(`Applied migration ${file}`)
    }
    return applied
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined)
    client.release()
  }
}

/** Filenames of migrations that exist on disk but haven't been applied to this database. */
export async function pendingMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect()
  try {
    const done = await appliedMigrations(client)
    return (await listMigrationFiles()).filter((f) => !done.has(f))
  } finally {
    client.release()
  }
}
