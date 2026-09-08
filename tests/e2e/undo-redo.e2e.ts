import { expect, test, clickNativeMenuCommand } from './fixtures'
import type { ElectronApplication, Page } from '@playwright/test'

async function createLab(page: Page, app: ElectronApplication, directory: string) {
  await page.getByTestId('create-project-btn').click()
  await page.getByTestId('project-name-input').fill('Undo Lab')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, directory)
  await page.getByTestId('choose-folder-btn').click()
  await page.getByTestId('create-btn').click()
  await expect(page.getByTestId('project-view')).toBeVisible()
}

async function addDevice(page: Page, app: ElectronApplication) {
  await clickNativeMenuCommand(app, 'node:addChild')
  await page.getByTestId('add-child-input').fill('Device')
  await page.getByTestId('add-child-commit').click()
  await expect(page.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toBeVisible()
  await expect(page.getByTestId('project-undo-btn')).toBeEnabled()
}

test('toolbar and native menu undo/redo restore the same node and survive save', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await expect(appPage.getByTestId('project-undo-btn')).toBeDisabled()
  await addDevice(appPage, electronApp)
  const id = await appPage.evaluate(async () => {
    const result = await window.api.project.getCurrent()
    return result.ok ? result.data?.nodes.find(node => node.name === 'Device')?.id : null
  })
  await appPage.getByTestId('project-undo-btn').click()
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(0)
  await expect(appPage.getByTestId('project-redo-btn')).toBeEnabled()
  await clickNativeMenuCommand(electronApp, 'project:redo')
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toBeVisible()
  expect(await appPage.evaluate(async () => {
    const result = await window.api.project.getCurrent()
    return result.ok ? result.data?.nodes.find(node => node.name === 'Device')?.id : null
  })).toBe(id)
  await clickNativeMenuCommand(electronApp, 'project:save')
  await expect(appPage.getByTestId('project-undo-btn')).toBeEnabled()
  await clickNativeMenuCommand(electronApp, 'project:undo')
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(0)
  await clickNativeMenuCommand(electronApp, 'project:close')
  await expect(appPage.getByTestId('open-project-btn')).toBeVisible()
  expect(await appPage.evaluate(async () => window.api.project.editHistory())).toEqual({ ok: true, data: { undoLabel: null, redoLabel: null } })
})

test('native Undo inside a text field never undoes a project operation', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addDevice(appPage, electronApp)
  const search = appPage.getByTestId('search-input')
  await search.click()
  await search.pressSequentially('Device')
  await expect(search).toHaveValue('Device')
  await clickNativeMenuCommand(electronApp, 'project:undo')
  await expect(search).toHaveValue('')
  // An empty text undo stack must not fall through to project undo.
  await clickNativeMenuCommand(electronApp, 'project:undo')
  expect(await appPage.evaluate(async () => {
    const result = await window.api.project.getCurrent()
    return result.ok ? result.data?.nodes.length : 0
  })).toBe(2)
  await clickNativeMenuCommand(electronApp, 'project:redo')
  await expect(search).toHaveValue('Device')
  await appPage.getByTestId('project-undo-btn').click()
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(0)
})

test('native keyboard accelerators undo and redo when the tree owns focus', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addDevice(appPage, electronApp)
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' }).click()
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow()!
    const modifiers = process.platform === 'darwin' ? ['meta'] : ['control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers })
  })
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toHaveCount(0)
  await expect(appPage.getByTestId('project-redo-btn')).toBeEnabled()
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow()!
    const keyCode = process.platform === 'win32' ? 'Y' : 'Z'
    const modifiers = process.platform === 'darwin' ? ['meta', 'shift'] : process.platform === 'win32' ? ['control'] : ['control', 'shift']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  })
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toBeVisible()
})

test('snapshots keep edit history, compare disables it, and revert clears it', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await appPage.getByTestId('open-snapshots-btn').click()
  await appPage.getByTestId('snapshot-name-input').fill('baseline')
  await appPage.getByTestId('create-snapshot-btn').click()
  await expect(appPage.getByTestId('snapshot-row').filter({ hasText: 'baseline' })).toBeVisible()
  await addDevice(appPage, electronApp)
  await appPage.getByTestId('project-undo-btn').click()
  await expect(appPage.getByTestId('project-mode-badge')).toHaveText('Current project matches baseline')
  await appPage.getByTestId('project-redo-btn').click()
  await expect(appPage.getByTestId('project-mode-badge')).toHaveText('Unsnapshotted changes')
  await appPage.getByTestId('snapshot-name-input').fill('with-device')
  await appPage.getByTestId('create-snapshot-btn').click()
  await expect(appPage.getByTestId('snapshot-row').filter({ hasText: 'with-device' })).toBeVisible()
  await expect(appPage.getByTestId('project-undo-btn')).toBeEnabled()
  await appPage.getByTestId('compare-from-select').selectOption('baseline')
  await appPage.getByTestId('compare-to-select').selectOption('with-device')
  await appPage.getByTestId('compare-snapshots-btn').click()
  await expect(appPage.getByTestId('exit-compare-btn')).toBeVisible()
  await expect(appPage.getByTestId('project-undo-btn')).toBeDisabled()
  await clickNativeMenuCommand(electronApp, 'project:undo')
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Device' })).toBeVisible()
  await appPage.getByTestId('exit-compare-btn').click()
  await expect(appPage.getByTestId('project-undo-btn')).toBeEnabled()
  await appPage.getByRole('button', { name: 'Revert Current Project to This Snapshot: baseline', exact: true }).click()
  await expect(appPage.getByTestId('revert-dialog')).toContainText('clears the current Undo/Redo history')
  await appPage.getByTestId('revert-note-input').fill('Retry test from baseline')
  await appPage.getByTestId('revert-confirm-btn').click()
  await expect(appPage.getByTestId('revert-dialog')).toHaveCount(0)
  await expect(appPage.getByTestId('project-undo-btn')).toBeDisabled()
  await expect(appPage.getByTestId('project-redo-btn')).toBeDisabled()
})
