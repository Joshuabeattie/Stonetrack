// `npm run db:migrate` — apply any pending SQL migrations to the database in DATABASE_URL.
import { runMigrations } from '../db/migrate'
import { closePool, getPool } from '../db/pool'

async function main() {
  const applied = await runMigrations(getPool(), (message) => console.log(`✔ ${message}`))
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is already up to date.')
}

main()
  .catch((err) => {
    console.error(`✘ ${(err as Error).message}`)
    process.exitCode = 1
  })
  .finally(() => closePool())
