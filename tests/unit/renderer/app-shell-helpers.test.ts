import { describe, expect, it } from 'vitest'
import { expandToReveal, resolveCompareSelectionId, scopeSelectionId, seedCompareExpanded } from '../../../src/renderer/src/lib/compare-session'
import { detailReadOnlyReason, editLockReason, formatProjectMode, isEditingLocked, type EditLockState } from '../../../src/renderer/src/lib/project-status'
import { inventoryFilterCount, searchRevealIds } from '../../../src/renderer/src/lib/inventory-search'
import { deleteSubtreeConfirmMessage, referenceBlockersConfirmMessage, referenceBlockersFromContext } from '../../../src/renderer/src/lib/node-delete'
import { dragPaneWidth, serializeWorkspacePaneSettings } from '../../../src/renderer/src/lib/pane-layout'
import { CURRENT_PROJECT_REF, snapshotRefLabel } from '../../../src/shared/snapshot-ref'
import type { MergedTreeNode } from '../../../src/shared/merged-tree'
import type { ManifestNode, ReferenceBlocker } from '../../../src/shared/types'

function node(id: string, parentId: string | null): ManifestNode {
  return { id, parentId, name: id, order: 0, properties: {}, created: '', modified: '' }
}

function merged(id: string, parentId: string | null, status: MergedTreeNode['status'] = 'unchanged'): MergedTreeNode {
  return { ...node(id, parentId), status, diffs: [] }
}

describe('compare-session', () => {
  const nodes = [
    merged('root', null),
    merged('room', 'root'),
    merged('rack', 'room', 'modified'),
    merged('ghost:old', 'room', 'removed'),
    merged('other', 'root'),
  ]

  it('seeds expansion with browse state plus every changed node and its ancestors', () => {
    expect([...seedCompareExpanded(['other'], nodes)].sort()).toEqual(['ghost:old', 'other', 'rack', 'room', 'root'])
  })

  it('resolves a node to its live row, then its ghost row, then itself', () => {
    expect(resolveCompareSelectionId('rack', nodes)).toBe('rack')
    expect(resolveCompareSelectionId('old', nodes)).toBe('ghost:old')
    expect(resolveCompareSelectionId('missing', nodes)).toBe('missing')
  })

  it('selects the ghost row for a scope root that only exists as a ghost', () => {
    expect(scopeSelectionId('room', nodes)).toBe('room')
    expect(scopeSelectionId('old', nodes)).toBe('ghost:old')
  })

  it('reveals a node by expanding it and its ancestors', () => {
    expect([...expandToReveal(['x'], 'rack', nodes)]).toEqual(['x', 'root', 'room', 'rack'])
  })
})

describe('project-status', () => {
  const idle: EditLockState = {
    interruptedHistory: false,
    externalDocumentConflict: false,
    undoRedoBusy: false,
    snapshotCreating: false,
    compareMode: false,
    snapshotRestoringName: null,
    recoveryApplyingId: null,
  }

  it('labels the working copy relative to its base snapshot', () => {
    expect(formatProjectMode(null, null, false)).toBe('Current Project')
    expect(formatProjectMode(null, null, true)).toBe('Unsnapshotted changes')
    expect(formatProjectMode(null, 'v1', false)).toBe('Current project matches v1')
    expect(formatProjectMode(null, 'v1', true)).toBe('Unsnapshotted changes')
  })

  it('labels a comparison with the current-project ref spelled out', () => {
    const label = formatProjectMode({ fromSnapshot: 'v1', toSnapshot: CURRENT_PROJECT_REF }, 'v1', false)
    expect(label).toBe(`Comparing v1 -> ${snapshotRefLabel(CURRENT_PROJECT_REF)}`)
    expect(label).not.toContain(CURRENT_PROJECT_REF)
  })

  it('locks editing for any in-flight operation', () => {
    expect(isEditingLocked(idle)).toBe(false)
    expect(isEditingLocked({ ...idle, undoRedoBusy: true })).toBe(true)
    expect(isEditingLocked({ ...idle, snapshotRestoringName: 'v1' })).toBe(true)
    expect(isEditingLocked({ ...idle, recoveryApplyingId: 'r1' })).toBe(true)
  })

  it('reports the highest-priority lock reason', () => {
    expect(editLockReason(idle)).toBe('')
    expect(editLockReason({ ...idle, undoRedoBusy: true })).toBe('')
    expect(editLockReason({ ...idle, compareMode: true, interruptedHistory: true })).toBe('Review the unfinished history operation before editing.')
    expect(editLockReason({ ...idle, compareMode: true, snapshotRestoringName: 'v1' })).toBe('Exit compare to edit the current project.')
  })

  it('explains why the detail pane is read-only', () => {
    expect(detailReadOnlyReason(null, null, null)).toBeUndefined()
    expect(detailReadOnlyReason({ fromSnapshot: 'a', toSnapshot: 'b' }, 'v1', null)).toMatch(/^Viewing a -> b\. Snapshots are read-only/)
    expect(detailReadOnlyReason(null, 'v1', 'r1')).toMatch(/^Reverting/)
    expect(detailReadOnlyReason(null, null, 'r1')).toMatch(/^Applying recovery point/)
  })
})

describe('inventory-search', () => {
  it('reveals each match with its ancestors', () => {
    const nodes = [node('root', null), node('a', 'root'), node('a1', 'a'), node('b', 'root')]
    expect([...searchRevealIds(nodes, [{ nodeId: 'a1' }])].sort()).toEqual(['a', 'a1', 'root'])
  })

  it('counts filter groups, with a property predicate counting once and only when complete', () => {
    expect(inventoryFilterCount({})).toBe(0)
    expect(inventoryFilterCount({ subtreeId: 'a', templateId: 't', missingRequired: true })).toBe(3)
    expect(inventoryFilterCount({ propertyKey: 'model' })).toBe(0)
    expect(inventoryFilterCount({ propertyKey: 'model', propertyOperator: 'contains', propertyValue: 'x' })).toBe(1)
  })
})

describe('node-delete', () => {
  it('pluralizes the descendant count', () => {
    expect(deleteSubtreeConfirmMessage('Rack', 1)).toBe('Delete "Rack" and its 1 descendant?')
    expect(deleteSubtreeConfirmMessage('Rack', 3)).toBe('Delete "Rack" and its 3 descendants?')
  })

  it('ignores a malformed blockers context', () => {
    expect(referenceBlockersFromContext(undefined)).toEqual([])
    expect(referenceBlockersFromContext({ blockers: 'nope' })).toEqual([])
  })

  it('lists node and template-default blockers', () => {
    const blockers: ReferenceBlocker[] = [
      { kind: 'node', nodeId: 'n1', nodeName: 'Server', key: 'rack', targetId: 'r', targetName: 'Rack' },
      { kind: 'template-default', nodeId: null, nodeName: 'Server', templateId: 't', key: 'rack', targetId: 'r', targetName: 'Rack' },
    ]
    expect(referenceBlockersConfirmMessage('Rack', blockers)).toBe(
      '"Rack" has 2 incoming references:\n\n' +
      '• Server → rack (→ Rack)\n' +
      '• Template "Server" default → rack (→ Rack)\n\n' +
      'Delete "Rack" and clear all 2?'
    )
    expect(referenceBlockersConfirmMessage('Rack', blockers.slice(0, 1))).toMatch(/has 1 incoming reference:[\s\S]*clear it\?$/)
  })
})

describe('pane-layout', () => {
  it('clamps the tree pane and grows the snapshots panel when dragged left', () => {
    expect(dragPaneWidth('tree', 288, 50)).toBe(338)
    expect(dragPaneWidth('tree', 288, -500)).toBe(160)
    expect(dragPaneWidth('tree', 288, 500)).toBe(520)
    expect(dragPaneWidth('panel', 320, -50)).toBe(370)
    expect(dragPaneWidth('panel', 320, 500)).toBe(240)
    expect(dragPaneWidth('panel', 320, -500)).toBe(600)
  })

  it('lets the Table view pane grow past the tree maximum but not below its minimum', () => {
    expect(dragPaneWidth('table', 520, 120)).toBe(640)
    expect(dragPaneWidth('table', 520, -100)).toBe(520)
    expect(dragPaneWidth('table', 520, 2000)).toBe(960)
  })

  it('serializes rounded widths', () => {
    expect(serializeWorkspacePaneSettings({ treeWidth: 288.4, tableWidth: 600.5, panelWidth: 320.6 }))
      .toBe('{"treeWidth":288,"tableWidth":601,"panelWidth":321}')
  })
})
