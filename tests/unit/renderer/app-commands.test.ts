import { describe, expect, it } from 'vitest'
import { buildMenuCommandState, canUndoProject, editShortcutFor, type CommandContext } from '../../../src/renderer/src/lib/app-commands'

// An open project with one live child node selected and nothing in flight.
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    appState: 'open',
    hasProject: true,
    creating: false,
    editingLocked: false,
    textEditing: false,
    undoRedoBusy: false,
    editHistory: { undoLabel: 'Rename', redoLabel: null },
    archiveOpen: false,
    importDialogOpen: false,
    templateManagerOpen: false,
    batchDialogOpen: false,
    duplicateNodeId: null,
    moveToNodeId: null,
    addingChildTo: null,
    revertDialogSnapshotName: null,
    recoveryDialogPoint: null,
    snapshotCreating: false,
    snapshotComparing: false,
    snapshotRestoringName: null,
    recoveryApplyingId: null,
    selectedId: 'child',
    selectedCount: 1,
    selectedNode: { parentId: 'root' },
    compareMode: false,
    compareLoaded: false,
    ...overrides,
  }
}

function enabled(state: Record<string, boolean>): string[] {
  return Object.entries(state).filter(([, on]) => on).map(([id]) => id).sort()
}

describe('buildMenuCommandState', () => {
  it('enables only New and Open on the welcome screen', () => {
    const state = buildMenuCommandState(ctx({ appState: 'welcome', hasProject: false, selectedId: null, selectedCount: 0, selectedNode: null }))
    expect(enabled(state)).toEqual(['project:new', 'project:open'])
  })

  it('disables Open while a project is being created or loaded', () => {
    expect(buildMenuCommandState(ctx({ appState: 'creating', hasProject: false }))['project:open']).toBe(false)
    expect(buildMenuCommandState(ctx({ appState: 'loading', hasProject: false }))['project:open']).toBe(false)
    expect(buildMenuCommandState(ctx({ appState: 'welcome', hasProject: false, creating: true }))['project:open']).toBe(false)
  })

  it('enables project and node commands for a selected child', () => {
    expect(enabled(buildMenuCommandState(ctx()))).toEqual([
      'history:reindex',
      'node:addChild',
      'node:delete',
      'node:duplicate',
      'node:moveTo',
      'node:rename',
      'project:close',
      'project:import',
      'project:open',
      'project:save',
      'project:search',
      'project:snapshots',
      'project:templates',
      'project:undo',
    ])
  })

  it('does not allow duplicating, moving, or deleting the root', () => {
    const state = buildMenuCommandState(ctx({ selectedId: 'root', selectedNode: { parentId: null } }))
    expect(state['node:addChild']).toBe(true)
    expect(state['node:rename']).toBe(true)
    expect(state['node:duplicate']).toBe(false)
    expect(state['node:moveTo']).toBe(false)
    expect(state['node:delete']).toBe(false)
  })

  it('disables node commands for a ghost selection', () => {
    const state = buildMenuCommandState(ctx({ selectedId: 'ghost:child' }))
    expect(state['node:addChild']).toBe(false)
    expect(state['node:rename']).toBe(false)
    expect(state['node:delete']).toBe(false)
  })

  it('blocks duplicate, move, and delete while a snapshot dialog or compare load is pending', () => {
    for (const overrides of [
      { snapshotComparing: true },
      { revertDialogSnapshotName: 'v1' },
      { recoveryDialogPoint: { id: 'r1' } },
    ]) {
      const state = buildMenuCommandState(ctx(overrides))
      expect(state['node:duplicate']).toBe(false)
      expect(state['node:moveTo']).toBe(false)
      expect(state['node:delete']).toBe(false)
      expect(state['node:rename']).toBe(true)
    }
  })

  it('disables single-node commands for a multi-selection', () => {
    const state = buildMenuCommandState(ctx({ selectedCount: 2 }))
    expect(state['node:addChild']).toBe(false)
    expect(state['node:delete']).toBe(false)
  })

  it('locks edits but keeps project commands while editing is locked', () => {
    const state = buildMenuCommandState(ctx({ editingLocked: true }))
    expect(state['project:save']).toBe(true)
    expect(state['project:import']).toBe(false)
    expect(state['node:rename']).toBe(false)
    expect(state['project:undo']).toBe(false)
  })

  it('treats an open duplicate dialog as busy', () => {
    const state = buildMenuCommandState(ctx({ duplicateNodeId: 'child' }))
    expect(state['project:save']).toBe(false)
    expect(state['project:open']).toBe(false)
  })

  it('enables compare and report commands only when a comparison is loaded', () => {
    const loading = buildMenuCommandState(ctx({ compareMode: true, compareLoaded: false, editingLocked: true }))
    expect(loading['compare:exit']).toBe(false)
    const loaded = buildMenuCommandState(ctx({ compareMode: true, compareLoaded: true, editingLocked: true }))
    expect(loaded['compare:exit']).toBe(true)
    expect(loaded['report:copyMarkdown']).toBe(true)
    expect(loaded['report:exportHtml']).toBe(true)
    expect(loaded['project:search']).toBe(false)
  })

  it('enables undo and redo for text fields regardless of project history', () => {
    const state = buildMenuCommandState(ctx({ textEditing: true, editHistory: { undoLabel: null, redoLabel: null } }))
    expect(state['project:undo']).toBe(true)
    expect(state['project:redo']).toBe(true)
    expect(state['node:delete']).toBe(false)
  })
})

describe('canUndoProject', () => {
  it('is blocked by any open dialog', () => {
    expect(canUndoProject(ctx())).toBe(true)
    expect(canUndoProject(ctx({ archiveOpen: true }))).toBe(false)
    expect(canUndoProject(ctx({ addingChildTo: 'root' }))).toBe(false)
    expect(canUndoProject(ctx({ recoveryDialogPoint: { id: 'r1' } }))).toBe(false)
  })
})

describe('editShortcutFor', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
    ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods })

  it('uses Cmd on macOS and Ctrl elsewhere', () => {
    expect(editShortcutFor(key('z', { metaKey: true }), 'darwin')).toBe('undo')
    expect(editShortcutFor(key('z', { ctrlKey: true }), 'darwin')).toBeNull()
    expect(editShortcutFor(key('z', { ctrlKey: true }), 'win32')).toBe('undo')
  })

  it('maps Shift+Z and Ctrl+Y to redo', () => {
    expect(editShortcutFor(key('Z', { metaKey: true, shiftKey: true }), 'darwin')).toBe('redo')
    expect(editShortcutFor(key('y', { ctrlKey: true }), 'linux')).toBe('redo')
    expect(editShortcutFor(key('y', { metaKey: true }), 'darwin')).toBeNull()
  })

  it('maps D to duplicate but not Shift+D', () => {
    expect(editShortcutFor(key('d', { ctrlKey: true }), 'linux')).toBe('duplicate')
    expect(editShortcutFor(key('d', { ctrlKey: true, shiftKey: true }), 'linux')).toBeNull()
  })
})
