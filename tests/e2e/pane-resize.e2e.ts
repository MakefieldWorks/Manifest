import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function dragHandle(page: Page, name: string, dx: number): Promise<void> {
  const box = (await page.getByRole('button', { name }).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 5 })
  await page.mouse.up()
}

async function leftPaneWidth(page: Page): Promise<number> {
  return Math.round((await page.getByTestId('tree').boundingBox())!.width)
}

test('resizes the left pane in Tree and Table views independently', async ({ appPage: page }) => {
  await page.getByTestId('open-example-project-btn').click()
  await expect(page.getByTestId('project-view')).toBeVisible()

  const tree = await leftPaneWidth(page)
  await dragHandle(page, 'Resize tree panel', 100)
  await expect.poll(() => leftPaneWidth(page)).toBe(tree + 100)

  await page.getByTestId('inventory-view-table').click()
  const table = await leftPaneWidth(page)
  await dragHandle(page, 'Resize tree panel', 120)
  await expect.poll(() => leftPaneWidth(page)).toBe(table + 120)

  // Widening the table leaves the tree width where it was.
  await page.getByTestId('inventory-view-tree').click()
  await expect.poll(() => leftPaneWidth(page)).toBe(tree + 100)
})

test('resizes the snapshots panel', async ({ appPage: page }) => {
  await page.getByTestId('open-example-project-btn').click()
  await expect(page.getByTestId('project-view')).toBeVisible()
  await page.getByTestId('open-snapshots-btn').click()

  const handle = page.getByRole('button', { name: 'Resize snapshots panel' })
  // The panel is docked right, so its handle moving left by 80px means the
  // panel grew by 80px.
  const handleX = async () => Math.round((await handle.boundingBox())!.x)
  const before = await handleX()
  await dragHandle(page, 'Resize snapshots panel', -80)
  await expect.poll(handleX).toBe(before - 80)
})
