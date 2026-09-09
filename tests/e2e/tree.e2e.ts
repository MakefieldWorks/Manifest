import { expect, test } from './fixtures'

/**
 * E2E tests for the virtualized Tree component (PR #1).
 *
 * These tests exercise:
 *   - Basic tree rendering (nodes visible, testids present)
 *   - Keyboard navigation (Arrow keys, Enter, F2)
 *   - Double-click to expand/collapse
 *   - Context menu actions (Add Child, Rename routing to DetailPane)
 *   - Virtualized viewport renders correctly for normal-size projects
 */

test('tree renders the project root node', async ({ appPage, electronApp, workspaceDir }) => {
  const projectName = 'Tree Test'

  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill(projectName)

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  // Root node should be visible.
  await expect(
    appPage.locator('[data-testid="tree-node"]', { hasText: projectName })
  ).toBeVisible()
})

test('context menu Add Child creates a new node', async ({ appPage, electronApp, workspaceDir }) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('Menu Test')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  // Right-click on the root node → Add Child.
  await appPage.locator('[data-testid="tree-node"]', { hasText: 'Menu Test' }).click({ button: 'right' })
  await appPage.getByRole('menuitem', { name: 'Add Child' }).click()
  await appPage.getByTestId('add-child-input').fill('Rack A')
  await appPage.getByTestId('add-child-commit').click()

  await expect(
    appPage.locator('[data-testid="tree-node"]', { hasText: 'Rack A' })
  ).toBeVisible()
})

test('double-click on a node with children toggles expand/collapse', async ({
  appPage,
  electronApp,
  workspaceDir,
}) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('Dblclick Test')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  // Add a child so root has children.
  await appPage
    .locator('[data-testid="tree-node"]', { hasText: 'Dblclick Test' })
    .click({ button: 'right' })
  await appPage.getByRole('menuitem', { name: 'Add Child' }).click()
  await appPage.getByTestId('add-child-input').fill('Child Node')
  await appPage.getByTestId('add-child-commit').click()
  await expect(
    appPage.locator('[data-testid="tree-node"]', { hasText: 'Child Node' })
  ).toBeVisible()

  // Double-click root → should collapse (hide child).
  await appPage
    .locator('[data-testid="tree-node"]', { hasText: 'Dblclick Test' })
    .dblclick()
  await expect(
    appPage.locator('[data-testid="tree-node"]', { hasText: 'Child Node' })
  ).toHaveCount(0)

  // Double-click again → should expand (show child).
  await appPage
    .locator('[data-testid="tree-node"]', { hasText: 'Dblclick Test' })
    .dblclick()
  await expect(
    appPage.locator('[data-testid="tree-node"]', { hasText: 'Child Node' })
  ).toBeVisible()
})

test('F2 triggers rename in DetailPane', async ({ appPage, electronApp, workspaceDir }) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('F2 Rename Test')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  // Click the root node to select it, then press F2.
  await appPage.locator('[data-testid="tree-node"]').first().click()
  await appPage.getByTestId('manifest-view').focus()
  await appPage.getByTestId('manifest-view').press('F2')

  // DetailPane should enter name-editing mode: the name input becomes visible.
  await expect(appPage.getByTestId('name-input')).toBeVisible()
})

test('arrow key navigation moves through visible nodes', async ({
  appPage,
  electronApp,
  workspaceDir,
}) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('Keyboard Nav Test')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  // Add two children.
  for (const name of ['Alpha', 'Beta']) {
    await appPage
      .locator('[data-testid="tree-node"]', { hasText: 'Keyboard Nav Test' })
      .click({ button: 'right' })
    await appPage.getByRole('menuitem', { name: 'Add Child' }).click()
    await appPage.getByTestId('add-child-input').fill(name)
    await appPage.getByTestId('add-child-commit').click()
    await expect(
      appPage.locator('[data-testid="tree-node"]', { hasText: name })
    ).toBeVisible()
  }

  // Focus the tree viewport, press ArrowDown twice to move from root → Alpha → Beta.
  await appPage.getByTestId('manifest-view').focus()
  await appPage.getByTestId('manifest-view').press('ArrowDown')
  await appPage.getByTestId('manifest-view').press('ArrowDown')

  // The detail pane should show "Beta" after two ArrowDown presses select it.
  // (Selection is updated by Enter/Space, not just navigation, so we press Enter.)
  await appPage.getByTestId('manifest-view').press('Enter')
  await expect(appPage.getByTestId('detail-pane')).toContainText('Beta')
})

test('search box filters the tree and cycles matching nodes', async ({
  appPage,
  electronApp,
  workspaceDir,
}) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('Typeahead Lab')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  for (const name of ['Rack Alpha', 'Rack Beta', 'Shelf']) {
    await appPage
      .locator('[data-testid="tree-node"]', { hasText: 'Typeahead Lab' })
      .click({ button: 'right' })
    await appPage.getByRole('menuitem', { name: 'Add Child' }).click()
    await appPage.getByTestId('add-child-input').fill(name)
    await appPage.getByTestId('add-child-commit').click()
    await expect(appPage.locator('[data-testid="tree-node"]', { hasText: name })).toBeVisible()
  }

  const search = appPage.getByTestId('search-input')

  // Searching in the visible box keeps the tree visible, prunes nonmatching
  // branches, and selects the first match.
  await search.fill('rack')
  await expect(appPage.getByTestId('detail-pane')).toContainText('Rack Alpha')
  await expect(appPage.getByTestId('tree')).toBeVisible()
  await expect(appPage.getByTestId('search-results')).toHaveCount(0)
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Shelf' })).toHaveCount(0)

  // Both matches are highlighted in the tree.
  await expect(
    appPage.locator('[data-testid="tree-node"][data-row-matched="true"]')
  ).toHaveCount(2)

  // Enter cycles to the next match.
  await search.press('Enter')
  await expect(appPage.getByTestId('detail-pane')).toContainText('Rack Beta')

  // Shift+Enter cycles back to the previous match.
  await search.press('Shift+Enter')
  await expect(appPage.getByTestId('detail-pane')).toContainText('Rack Alpha')

  // Escape clears the search and restores the full expanded tree.
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(appPage.locator('[data-testid="tree-node"]', { hasText: 'Shelf' })).toBeVisible()

  // Typing while the tree has focus feeds the same visible search box.
  const view = appPage.getByTestId('manifest-view')
  await view.focus()
  await view.press('s')
  await expect(search).toHaveValue('s')
  await expect(appPage.getByTestId('detail-pane')).toContainText('Shelf')
})

test('search reports and incrementally loads more than 50 matches', async ({
  appPage,
  electronApp,
  workspaceDir,
}) => {
  await appPage.getByTestId('create-project-btn').click()
  await appPage.getByTestId('project-name-input').fill('Large Search Lab')

  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspaceDir)

  await appPage.getByTestId('choose-folder-btn').click()
  await appPage.getByTestId('create-btn').click()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  await appPage.evaluate(async () => {
    const current = await window.api.project.getCurrent()
    if (!current.ok) throw new Error(current.error.message)
    const root = current.data.nodes.find(node => node.parentId === null)
    if (!root) throw new Error('Project root missing')
    for (let index = 1; index <= 55; index++) {
      const created = await window.api.node.create(root.id, `Inventory Device ${String(index).padStart(2, '0')}`)
      if (!created.ok) throw new Error(created.error.message)
    }
  })
  await appPage.reload()
  await expect(appPage.getByTestId('project-view')).toBeVisible()

  const search = appPage.getByTestId('search-input')
  await search.fill('Inventory Device')
  await expect(appPage.getByText('Result 1 of 55', { exact: false })).toBeVisible()
  await expect(appPage.getByTestId('search-load-more')).toContainText('50 of 55')

  await appPage.getByTestId('search-load-more').click()
  await expect(appPage.getByTestId('search-load-more')).toHaveCount(0)
  await expect(appPage.getByText('Result 1 of 55', { exact: false })).not.toContainText('loaded')

  await search.press('Escape')
  await search.fill('Inventory Device')
  await expect(appPage.getByText('Result 1 of 55', { exact: false })).toBeVisible()
  for (let index = 1; index < 50; index++) await search.press('Enter')
  await expect(appPage.getByText('Result 50 of 55', { exact: false })).toBeVisible()
  await search.press('Enter')
  await expect(appPage.getByText('Result 51 of 55', { exact: false })).toBeVisible()
  await expect(appPage.getByTestId('search-load-more')).toHaveCount(0)
})
