import { defineConfig } from '@playwright/test'

// Each E2E test launches Electron. Keep its native windows out of the foreground
// by default; set MANIFEST_E2E_VISIBLE=1 to watch a run.
process.env['MANIFEST_E2E_BACKGROUND'] ??= process.env['MANIFEST_E2E_VISIBLE'] === '1' ? '0' : '1'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
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
