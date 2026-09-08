import { expect, test, clickNativeMenuCommand } from './fixtures'
import type { ElectronApplication, Page } from '@playwright/test'

async function createLab(page: Page, app: ElectronApplication, directory: string) {
  await page.getByTestId('create-project-btn').click()
  await page.getByTestId('project-name-input').fill('Batch Lab')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, directory)
  await page.getByTestId('choose-folder-btn').click()
  await page.getByTestId('create-btn').click()
  await expect(page.getByTestId('project-view')).toBeVisible()
}

async function addRootChild(page: Page, app: ElectronApplication, name: string) {
  await page.locator('[data-testid="tree-node"]').first().click()
  await clickNativeMenuCommand(app, 'node:addChild')
  await page.getByTestId('add-child-input').fill(name)
  await page.getByTestId('add-child-commit').click()
  await expect(page.getByTestId('node-name').getByRole('heading')).toHaveText(name)
}

async function addProperty(page: Page, nodeName: string, key: string, value: string) {
  await page.locator('[data-testid="tree-node"]', { hasText: nodeName }).click()
  await page.getByTestId('new-prop-key').fill(key)
  await page.getByTestId('new-prop-value').fill(value)
  await page.getByTestId('add-prop-btn').click()
  await expect(page.getByTestId('prop-value')).toHaveText(value)
}

test('multi-selects a range, previews a mixed-value batch, and undoes it as one operation', async ({ appPage, electronApp, workspaceDir }) => {
  await createLab(appPage, electronApp, workspaceDir)
  await addRootChild(appPage, electronApp, 'Device A')
  await addRootChild(appPage, electronApp, 'Device B')
  await addRootChild(appPage, electronApp, 'Device C')
  await addProperty(appPage, 'Device A', 'firmware', 'v1')
  await addProperty(appPage, 'Device B', 'firmware', 'v2')

  const a = appPage.locator('[data-testid="tree-node"]', { hasText: 'Device A' })
  const b = appPage.locator('[data-testid="tree-node"]', { hasText: 'Device B' })
  const c = appPage.locator('[data-testid="tree-node"]', { hasText: 'Device C' })
  const toggle = process.platform === 'darwin' ? ['Meta'] as const : ['Control'] as const
  await a.click()
  await b.click({ modifiers: [...toggle] })
  await expect(appPage.locator('[data-testid="tree-node"][aria-selected="true"]')).toHaveCount(2)
  await b.click({ modifiers: [...toggle] })
  await expect(appPage.locator('[data-testid="tree-node"][aria-selected="true"]')).toHaveCount(1)
  await c.click({ modifiers: ['Shift'] })
  await expect(appPage.locator('[data-testid="tree-node"][aria-selected="true"]')).toHaveCount(3)
  await expect(appPage.getByTestId('batch-selection-pane')).toContainText('3 nodes selected')

  await appPage.getByTestId('batch-edit-open').click()
  await appPage.getByTestId('batch-property-key').selectOption('firmware')
  await expect(appPage.getByTestId('batch-current-value')).toHaveText('Mixed values')
  await appPage.getByTestId('batch-property-value').fill('v3')
  await expect(appPage.getByTestId('batch-preview')).toContainText('3 of 3 nodes will change')
  await appPage.screenshot({ path: test.info().outputPath('batch-property-dialog.png') })
  await expect(appPage.getByTestId('batch-preview')).toContainText('Device A')
  await expect(appPage.getByTestId('batch-preview')).toContainText('v1 →')
  await expect(appPage.getByTestId('batch-preview')).toContainText('not set →')
  await appPage.getByTestId('batch-apply').click()
  await expect(appPage.getByTestId('batch-property-dialog')).toHaveCount(0)
  await expect(appPage.getByTestId('batch-selection-pane')).toBeVisible()

  await appPage.getByTestId('project-undo-btn').click()
  await a.click()
  await expect(appPage.getByTestId('prop-value')).toHaveText('v1')
  await b.click()
  await expect(appPage.getByTestId('prop-value')).toHaveText('v2')
  await c.click()
  await expect(appPage.getByTestId('prop-value')).toHaveCount(0)
  await appPage.getByTestId('project-redo-btn').click()
  await expect(appPage.getByTestId('prop-value')).toHaveText('v3')
})
