// All configuration in one place, read from environment variables once at startup.
//
// There are three profiles: development (npm run dev), test (npm test) and
// production (npm start / Replit publishing). Each profile has its own defaults,
// and environment variables override them. Invalid values stop the server at
// startup with a clear message, instead of failing later in a confusing way.
import 'dotenv/config'
import { z } from 'zod'

export type AppEnv = 'development' | 'test' | 'production'

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  REPLIT_DEPLOYMENT: z.string().optional(), // Replit sets this to "1" in published apps
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify']).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  DEMO_MODE: booleanish.optional(),
  FACTORY_TIMEZONE: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
})

const env = envSchema.parse(process.env)

const appEnv: AppEnv = env.NODE_ENV ?? (env.REPLIT_DEPLOYMENT === '1' ? 'production' : 'development')

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

interface Profile {
  host: string
  port: number
  serveClient: boolean // serve the built React app from dist/client
  runMigrationsOnStart: boolean
  logFormat: 'pretty' | 'json'
  logLevel: LogLevel
  webhookSecret: string | undefined
  databaseSsl: 'disable' | 'require' | 'verify'
}

const profiles: Record<AppEnv, Profile> = {
  development: {
    host: '127.0.0.1', // only Vite (same machine) talks to the API in development
    port: env.API_PORT ?? 3001,
    serveClient: false, // Vite serves the React app with hot reload
    runMigrationsOnStart: false, // you run `npm run db:migrate` yourself; the server warns if you forgot
    logFormat: 'pretty',
    logLevel: env.LOG_LEVEL ?? 'debug',
    webhookSecret: env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
    databaseSsl: env.DATABASE_SSL ?? 'disable', // Replit's development database doesn't use SSL
  },
  test: {
    host: '127.0.0.1',
    port: 0,
    serveClient: false,
    runMigrationsOnStart: false, // tests/globalSetup.ts migrates the test schema
    logFormat: 'pretty',
    logLevel: env.LOG_LEVEL ?? 'silent',
    webhookSecret: 'test-webhook-secret',
    databaseSsl: env.DATABASE_SSL ?? 'disable',
  },
  production: {
    host: '0.0.0.0', // Replit's proxy must be able to reach the server
    port: env.PORT ?? 5000,
    serveClient: true,
    runMigrationsOnStart: true, // safe: migrations are idempotent and run under a lock
    logFormat: 'json', // one JSON object per line: easy to search in Replit's logs
    logLevel: env.LOG_LEVEL ?? 'info',
    webhookSecret: env.WEBHOOK_SECRET, // no default: must be set in Replit's production secrets
    databaseSsl: env.DATABASE_SSL ?? 'require', // Replit's production database requires SSL
  },
}

const profile = profiles[appEnv]

if (appEnv === 'production' && (!profile.webhookSecret || profile.webhookSecret.length < 16)) {
  throw new Error(
    'WEBHOOK_SECRET must be set (at least 16 characters) in production. ' +
      'On Replit: Publishing → Adjust settings → production secrets.',
  )
}

export const config = {
  env: appEnv,
  isProduction: appEnv === 'production',
  isTest: appEnv === 'test',
  ...profile,
  webhookSecret: profile.webhookSecret ?? '',
  databaseUrl: env.DATABASE_URL ?? '',
  // A public portfolio demo: show the demo logins, seed an empty database and allow "reset demo".
  // Set DEMO_MODE=false for anything real.
  demoMode: env.DEMO_MODE ?? true,
  factoryTimezone: env.FACTORY_TIMEZONE ?? 'Australia/Melbourne',
  factoryName: 'StoneTrack Demo Factory',
  standardShiftHours: 7.6, // a standard Australian working day
  sessionHours: { admin: 12, manager: 12, kiosk: 24 * 30 }, // kiosk tablets stay signed in
  webhookToleranceSeconds: 300, // reject signed webhooks older than 5 minutes (replay protection)
  migrationsDir: 'server/db/migrations', // relative to the project root (the working directory)
  clientDir: 'dist/client',
} as const

export type Config = typeof config
