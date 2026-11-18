// `npm run db:seed` — replace ALL data in the database with the demo data set.
import { config } from '../config'
import { closePool, withTransaction } from '../db/pool'
import { DEMO_ACCOUNTS, seedDemoData } from '../db/seed'

async function main() {
  if (config.isProduction && !process.argv.includes('--force')) {
    throw new Error('Refusing to wipe a production database. Re-run with --force if you really mean it.')
  }
  const summary = await withTransaction((client) => seedDemoData(client))
  console.log(
    `✔ Seeded ${summary.jobs} jobs (${summary.activeJobs} on the floor, ${summary.dispatchedJobs} dispatched), ` +
      `${summary.slabs} slabs, ${summary.events} history events and ${summary.users} users.`,
  )
  console.log('Sign in with:')
  for (const account of DEMO_ACCOUNTS) console.log(`  ${account.role.padEnd(8)} ${account.username} / ${account.password}`)
}

main()
  .catch((err) => {
    console.error(`✘ ${(err as Error).message}`)
    process.exitCode = 1
  })
  .finally(() => closePool())
