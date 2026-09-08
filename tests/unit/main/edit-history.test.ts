import { describe, expect, it } from 'vitest'
import { EditHistory } from '../../../src/main/edit-history'
import type { Project } from '../../../src/shared/types'

function project(name: string): Project {
  return { id: 'p', name: 'Lab', version: 2, created: '', modified: '', nodes: [
    { id: 'root', name, parentId: null, order: 0, properties: {}, created: '', modified: '' },
  ] }
}

describe('bounded edit history', () => {
  it('evicts oldest operations without breaking undo/redo of retained operations', () => {
    const history = new EditHistory(2)
    for (const [before, after] of [['A', 'B'], ['B', 'C'], ['C', 'D']]) {
      history.record(history.prepare(project(before), project(after), after)!)
    }
    let current = project('D')
    for (const expected of ['C', 'B']) {
      current = history.preview(current, 'undo')!
      history.accept('undo')
      expect(current.nodes[0].name).toBe(expected)
    }
    expect(history.preview(current, 'undo')).toBeNull()
    expect(history.preview(current, 'redo')!.nodes[0].name).toBe('C')
  })

  it('retains a single oversized latest operation and releases prior history', () => {
    const history = new EditHistory(100, 1)
    history.record(history.prepare(project('A'), project('B'), 'first')!)
    history.record(history.prepare(project('B'), project('C'), 'second')!)
    expect(history.preview(project('C'), 'undo')!.nodes[0].name).toBe('B')
    history.accept('undo')
    expect(history.state()).toEqual({ undoLabel: null, redoLabel: 'second' })
  })

  it('captures defensive copies and ignores timestamp-only/property-key-order changes', () => {
    const history = new EditHistory()
    const before = project('A')
    const after = project('B')
    history.record(history.prepare(before, after, 'Rename')!)
    before.nodes[0].name = 'Mutated caller'
    const restored = history.preview(after, 'undo')!
    expect(restored.nodes[0].name).toBe('A')
    restored.nodes[0].name = 'Mutated preview'
    expect(history.preview(after, 'undo')!.nodes[0].name).toBe('A')
    const same = structuredClone(after)
    same.nodes[0].modified = 'later'
    expect(history.prepare(after, same, 'No-op')).toBeNull()
  })
})
