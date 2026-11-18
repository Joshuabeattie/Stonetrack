// Runs once before all test files: recreate the test schema and apply migrations to it.
import pg from 'pg'
import { runMigrations } from '../server/db/migrate'
import { TEST_SCHEMA, baseDatabaseUrl, testDatabaseUrl, testSsl } from './testDb'

export default async function setup() {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl(), ssl: testSsl() })
  await admin.connect()
  await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`)
  await admin.end()

  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), ssl: testSsl(), max: 2 })
  // Safety check: if the server ignored our search_path option, stop before touching anything.
  const { rows } = await pool.query<{ schema: string }>('SELECT current_schema() AS schema')
  if (rows[0]?.schema !== TEST_SCHEMA) {
    await pool.end()
    throw new Error(`Refusing to run tests: expected schema ${TEST_SCHEMA} but connected to ${rows[0]?.schema}`)
  }
  await runMigrations(pool)
  await pool.end()

  // Teardown: drop the test schema when the run finishes.
  return async () => {
    const cleanup = new pg.Client({ connectionString: baseDatabaseUrl(), ssl: testSsl() })
    await cleanup.connect()
    await cleanup.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await cleanup.end()
  }
}
