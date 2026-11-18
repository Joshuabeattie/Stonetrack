// Runs in each test worker before the test file is loaded, so that when the app's
// config is read it picks up the test profile and the test-schema database URL.
import { testDatabaseUrl } from './testDb'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = testDatabaseUrl()
