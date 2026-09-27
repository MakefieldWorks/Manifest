import { defineConfig } from '@playwright/test'

// Each E2E test launches Electron. Keep its native windows out of the foreground
// by default; set MANIFEST_E2E_VISIBLE=1 to watch a run.
process.env['MANIFEST_E2E_BACKGROUND'] = process.env['MANIFEST_E2E_VISIBLE'] === '1'
  ? '0'
  : (process.env['MANIFEST_E2E_BACKGROUND'] ?? '1')

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  // Windows CI runners can be much slower when Electron, SQLite, and the UI
  // share a busy host. Keep local and macOS failures fast while allowing the
  // Windows pilot run enough time for real UI work to complete.
  timeout: process.env['CI'] && process.platform === 'win32' ? 90_000 : 30_000,
  expect: {
    timeout: process.env['CI'] && process.platform === 'win32' ? 15_000 : 5_000,
  },
  forbidOnly: !!process.env['CI'],
  reporter: 'list',
  outputDir: '.playwright-artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
