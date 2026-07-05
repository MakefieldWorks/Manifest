import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT_DIR = process.cwd()
const MAIN_ENTRY = join(ROOT_DIR, 'out', 'main', 'index.js')
const dogfoodProjectPath = process.env['MANIFEST_DOGFOOD_PROJECT']

test.skip(!dogfoodProjectPath, 'Set MANIFEST_DOGFOOD_PROJECT to run the generated project dogfood smoke coverage.')

async function firstAppWindow(electronApp: ElectronApplication): Promise<Page> {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return page
}

test('opens and navigates the generated dogfood project', async () => {
  if (!dogfoodProjectPath) throw new Error('Missing MANIFEST_DOGFOOD_PROJECT')
  if (!existsSync(MAIN_ENTRY)) throw new Error(`Built Electron entrypoint not found: ${MAIN_ENTRY}`)
  if (!existsSync(dogfoodProjectPath)) throw new Error(`Dogfood project not found: ${dogfoodProjectPath}`)

  const electronApp = await electron.launch({
    args: [MAIN_ENTRY, dogfoodProjectPath],
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  })

  try {
    const page = await firstAppWindow(electronApp)

    await expect(page.getByTestId('project-view')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('project-titlebar')).toContainText('Pilot Lab Inventory')

    const chrome = await page.evaluate(() => window.api.platform)
    const titlebarClass = await page.getByTestId('project-titlebar').getAttribute('class')
    expect(titlebarClass ?? '').toContain(chrome.reservesTrafficLightSpace ? 'pl-20' : 'pl-4')
    await expect(page.getByTestId('window-drag-region')).toHaveCount(chrome.supportsWindowDragRegion ? 1 : 0)

    await page.getByTestId('search-input').fill('active')
    await expect(page.getByTestId('tree-node').first()).toBeVisible()
    await page.getByTestId('search-input').press('Enter')
    await expect(page.getByTestId('node-name')).not.toHaveText('Pilot Lab Inventory')

    await page.getByTestId('open-snapshots-btn').click()
    await expect(page.getByTestId('snapshots-panel')).toBeVisible()
    await page.getByTestId('compare-from-select').selectOption('generated-01')
    await page.getByTestId('compare-to-select').selectOption('generated-04')
    await expect(page.getByTestId('compare-snapshots-btn')).toBeEnabled()
    await page.getByTestId('compare-snapshots-btn').click()
    await expect(page.getByTestId('snapshot-diff-list')).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => page.getByTestId('snapshot-diff-row').count()).toBeGreaterThan(0)
  } finally {
    await electronApp.close()
  }
})
