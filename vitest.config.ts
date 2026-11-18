import { defineConfig } from 'vitest/config'

// API tests run against a real PostgreSQL database, in a separate schema
// (stonetrack_test) so your development data is never touched.
// See tests/testDb.ts for how the test connection is built.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setupEnv.ts'],
    // Test files share one database schema, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
