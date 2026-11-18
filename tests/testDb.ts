// Where the tests keep their data.
//
// Replit gives each app one development database, so the tests can't have a
// database of their own. Instead they use a separate *schema* (a namespace of
// tables) called stonetrack_test inside the same database. Every test connection
// sets `search_path=stonetrack_test`, so unqualified table names like `jobs`
// resolve to stonetrack_test.jobs, never to your development data in public.jobs.
import 'dotenv/config'

export const TEST_SCHEMA = 'stonetrack_test'

export function baseDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to run the tests. On Replit it is set for you.')
  }
  return url
}

/** The same database URL, with every connection's search_path pointed at the test schema. */
export function testDatabaseUrl(): string {
  const url = new URL(baseDatabaseUrl())
  url.searchParams.set('options', `-c search_path=${TEST_SCHEMA}`)
  return url.toString()
}

export function testSsl() {
  const mode = process.env.DATABASE_SSL
  if (mode === 'require') return { rejectUnauthorized: false }
  if (mode === 'verify') return { rejectUnauthorized: true }
  return false
}
