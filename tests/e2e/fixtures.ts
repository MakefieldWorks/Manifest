import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MenuCommandId } from '../../src/shared/menu-commands'

const ROOT_DIR = process.cwd()
const MAIN_ENTRY = join(ROOT_DIR, 'out', 'main', 'index.js')

type ManifestFixtures = {
  electronApp: ElectronApplication
  appPage: Page
  workspaceDir: string
}

export const test = base.extend<ManifestFixtures>({
  workspaceDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-e2e-'))
    try {
      await use(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },

  electronApp: async ({ workspaceDir }, use) => {
    void workspaceDir
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(`Built Electron entrypoint not found at ${MAIN_ENTRY}. Run "bun run build" first.`)
    }

    const electronApp = await electron.launch({
      // Keep each test independent from a running copy of Manifest and from
      // any persisted user preferences on the development machine.
      args: [MAIN_ENTRY, `--user-data-dir=${join(workspaceDir, 'electron-user-data')}`],
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MANIFEST_EXAMPLE_PROJECTS_DIR: join(workspaceDir, 'example-projects'),
      },
    })

    try {
      await use(electronApp)
    } finally {
      await electronApp.close()
    }
  },

  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('create-project-btn')).toBeVisible()
    await use(page)
  },
})

export { expect }

export async function clickNativeMenuCommand(
  electronApp: ElectronApplication,
  command: MenuCommandId,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    const window = BrowserWindow.getAllWindows()[0]
    if (!item || !window) throw new Error(`Native menu command not found: ${id}`)
    item.click(item, window, undefined as never)
  }, command)
}
