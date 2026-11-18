// The migration files, bundled into the Worker as text: a Worker can't read the
// project folder at runtime. wrangler.jsonc tells Wrangler to import .sql files as text.
// tests/cloudflare.test.ts fails if a .sql file in server/db/migrations is missing here.
import type { Migration } from '../server/db/migrate'
import initialSchema from '../server/db/migrations/001_initial_schema.sql'

export const bundledMigrations: Migration[] = [{ name: '001_initial_schema.sql', sql: initialSchema }]
