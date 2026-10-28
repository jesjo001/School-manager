import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // Same alias as tsconfig: tests import `@/lib/...` exactly like the app.
    alias: { '@': root.replace(/\/$/, '') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The suites share one MongoDB, so they run one file at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
