import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Windows CI runs many filesystem-heavy Git/SQLite suites on two cores.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    hookTimeout: process.platform === 'win32' ? 30_000 : 10_000,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
