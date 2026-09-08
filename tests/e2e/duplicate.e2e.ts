import { expect, test, clickNativeMenuCommand } from './fixtures'
import type { ElectronApplication, Page } from '@playwright/test'

async function createLab(page: Page, app: ElectronApplication, directory: string) {
  await page.getByTestId('create-project-btn').click()
  await page.getByTestId('project-name-input').fill('Duplicate Lab')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, directory)
  await page.getByTestId('choose-folder-btn').click()
  await page.getByTestId('create-btn').click()
  await expect(page.getByTestId('project-view')).toBeVisible()
}

async function addChild(page: Page, app: ElectronApplication, name: string) {
  await clickNativeMenuCommand(app, 'node:addChild')
  await page.getByTestId('add-child-input').fill(name)
  await page.getByTestId('add-child-commit').click()
  await expect(page.getByTestId('node-name').getByRole('heading')).toHaveText(name)
}

test('duplicates a subtree from its context menu and supports Undo/Redo', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addChild(appPage, electronApp, 'Rack')
  await addChild(appPage, electronApp, 'Device')
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Rack' }).click({ button: 'right' })
  await appPage.getByRole('menuitem', { name: 'Duplicate…' }).click()
  await expect(appPage.getByTestId('duplicate-dialog')).toContainText('including 1 descendant')
  await expect(appPage.getByTestId('duplicate-name-input')).toHaveValue('Rack copy')
  await expect(appPage.getByTestId('duplicate-name-input')).toBeFocused()
  await appPage.screenshot({ path: test.info().outputPath('duplicate-dialog.png') })
  await expect(appPage.getByTestId('project-undo-btn')).toBeDisabled()
  await appPage.getByTestId('duplicate-confirm').click()
  await expect(appPage.getByTestId('duplicate-dialog')).toHaveCount(0)
  await expect(appPage.getByTestId('node-name').getByRole('heading')).toHaveText('Rack copy')
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(2)
  await appPage.getByTestId('project-undo-btn').click()
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Rack copy' })).toHaveCount(0)
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(1)
  await appPage.getByTestId('project-redo-btn').click()
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Rack copy' })).toBeVisible()
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(2)
})

test('validates names, allows cancellation, and suggests an available repeated-copy name', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addChild(appPage, electronApp, 'Device')
  await clickNativeMenuCommand(electronApp, 'node:duplicate')
  await appPage.getByTestId('duplicate-name-input').fill('device')
  await expect(appPage.getByTestId('duplicate-validation')).toContainText('already exists')
  await expect(appPage.getByTestId('duplicate-confirm')).toBeDisabled()
  await appPage.getByTestId('duplicate-name-input').fill('bad/name')
  await expect(appPage.getByTestId('duplicate-validation')).toContainText('slashes')
  await appPage.getByTestId('duplicate-name-input').press('Escape')
  await expect(appPage.getByTestId('duplicate-dialog')).toHaveCount(0)
  await expect(appPage.locator('[data-testid="tree-node"]')).toHaveCount(2)
  await clickNativeMenuCommand(electronApp, 'node:duplicate')
  await appPage.getByTestId('duplicate-name-input').press('Enter')
  await expect(appPage.getByTestId('node-name').getByRole('heading')).toHaveText('Device copy')
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' }).first().click()
  await clickNativeMenuCommand(electronApp, 'node:duplicate')
  await expect(appPage.getByTestId('duplicate-name-input')).toHaveValue('Device copy 2')
  await appPage.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('disables duplication for the root and during comparison', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  const enabled = () => electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('node:duplicate')!.enabled)
  await expect.poll(enabled).toBe(false)
  await addChild(appPage, electronApp, 'Device')
  await expect.poll(enabled).toBe(true)
  await appPage.getByTestId('open-snapshots-btn').click()
  await appPage.getByTestId('snapshot-name-input').fill('baseline')
  await appPage.getByTestId('create-snapshot-btn').click()
  await expect(appPage.getByTestId('snapshot-row').filter({ hasText: 'baseline' })).toBeVisible()
  await appPage.getByTestId('compare-from-select').selectOption('baseline')
  await appPage.getByTestId('compare-to-select').selectOption('@current')
  await appPage.getByTestId('compare-snapshots-btn').click()
  await expect(appPage.getByTestId('exit-compare-btn')).toBeVisible()
  await expect.poll(enabled).toBe(false)
  await clickNativeMenuCommand(electronApp, 'node:duplicate')
  await expect(appPage.getByTestId('duplicate-dialog')).toHaveCount(0)
  await appPage.getByTestId('exit-compare-btn').click()
  await expect.poll(enabled).toBe(true)
})

test('keyboard shortcut opens a focused modal and Enter creates the copy', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addChild(appPage, electronApp, 'Device')
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' }).click()
  const enabled = () => electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('node:duplicate')!.enabled)
  await clickNativeMenuCommand(electronApp, 'node:rename')
  await expect(appPage.getByTestId('name-input')).toBeFocused()
  await expect.poll(enabled).toBe(false)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow()!
    const modifiers = process.platform === 'darwin' ? ['meta'] : ['control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers })
  })
  await expect(appPage.getByTestId('duplicate-dialog')).toHaveCount(0)
  await appPage.getByTestId('name-input').press('Escape')
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' }).focus()
  await expect.poll(enabled).toBe(true)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow()!
    const modifiers = process.platform === 'darwin' ? ['meta'] : ['control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers })
  })
  await expect(appPage.getByTestId('duplicate-name-input')).toBeFocused()
  await appPage.getByTestId('duplicate-name-input').press('Shift+Tab')
  await expect(appPage.getByTestId('duplicate-confirm')).toBeFocused()
  await appPage.getByTestId('duplicate-confirm').press('Tab')
  await expect(appPage.getByTestId('duplicate-name-input')).toBeFocused()
  await appPage.getByTestId('duplicate-name-input').fill('Replacement device')
  await appPage.getByTestId('duplicate-name-input').press('Enter')
  await expect(appPage.getByTestId('node-name').getByRole('heading')).toHaveText('Replacement device')
})
