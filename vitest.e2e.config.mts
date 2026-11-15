import { defineConfig } from 'vitest/config'

// End-to-end suite: drives the built app with Playwright. WW_E2E is set here
// (not with POSIX `VAR=1 cmd` syntax) so `npm run test:e2e` works on Windows too.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    env: { WW_E2E: '1' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000
  }
})
