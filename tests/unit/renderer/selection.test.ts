import { describe, expect, it } from 'vitest'
import { pruneSelection, selectWithModifiers, singleSelection, type SelectionState } from '../../../src/renderer/src/lib/selection'

function rows(...ids: string[]) {
  return ids.map(id => ({ id, node: { id: id.replace(/^ghost:/, '') } }))
}

function state(selectedId: string | null, ids: string[], recency = ids, anchor: string | null = selectedId): SelectionState {
  return { selectedId, selectedIds: new Set(ids), selectionRecency: recency, selectionAnchorId: anchor }
}

const TOGGLE = { toggle: true, range: false }
const RANGE = { toggle: false, range: true }

describe('singleSelection', () => {
  it('selects one node as primary, member, most recent, and anchor', () => {
    expect(singleSelection('a')).toEqual(state('a', ['a']))
  })

  it('clears everything for null', () => {
    expect(singleSelection(null)).toEqual(state(null, [], [], null))
  })
})

describe('selectWithModifiers', () => {
  const visible = rows('root', 'a', 'b', 'c', 'd')

  it('single-selects on a plain click', () => {
    expect(selectWithModifiers(state('a', ['a', 'b']), 'c', undefined, visible, false)).toEqual(singleSelection('c'))
  })

  it('single-selects in compare mode even with modifiers', () => {
    expect(selectWithModifiers(state('a', ['a']), 'c', TOGGLE, visible, true)).toEqual(singleSelection('c'))
  })

  it('single-selects ghost rows even with modifiers', () => {
    expect(selectWithModifiers(state('a', ['a']), 'ghost:x', RANGE, visible, false)).toEqual(singleSelection('ghost:x'))
  })

  it('toggles a node in and makes it primary and anchor', () => {
    const next = selectWithModifiers(state('a', ['a']), 'c', TOGGLE, visible, false)
    expect(next).toEqual(state('c', ['a', 'c'], ['a', 'c'], 'c'))
  })

  it('toggling the primary out falls back to the most recently added remaining node', () => {
    const current = state('c', ['a', 'b', 'c'], ['b', 'a', 'c'])
    const next = selectWithModifiers(current, 'c', TOGGLE, visible, false)
    expect(next.selectedId).toBe('a')
    expect(next.selectionAnchorId).toBe('a')
    expect([...next.selectedIds]).toEqual(['a', 'b'])
    expect(next.selectionRecency).toEqual(['b', 'a'])
  })

  it('toggling the last node out leaves nothing selected', () => {
    expect(selectWithModifiers(state('a', ['a']), 'a', TOGGLE, visible, false)).toEqual(state(null, [], [], null))
  })

  it('range-selects visible rows between the anchor and the target, in either direction', () => {
    const down = selectWithModifiers(state('a', ['a']), 'c', RANGE, visible, false)
    expect([...down.selectedIds]).toEqual(['a', 'b', 'c'])
    expect(down.selectedId).toBe('c')
    const up = selectWithModifiers(state('d', ['d']), 'b', RANGE, visible, false)
    expect([...up.selectedIds]).toEqual(['b', 'c', 'd'])
  })

  it('keeps the anchor across range clicks so the range can shrink', () => {
    const first = selectWithModifiers(state('a', ['a']), 'd', RANGE, visible, false)
    expect(first.selectionAnchorId).toBe('a')
    const second = selectWithModifiers(first, 'b', RANGE, visible, false)
    expect([...second.selectedIds]).toEqual(['a', 'b'])
    expect(second.selectionRecency).toEqual(['a', 'b'])
  })

  it('skips ghost rows when computing a range', () => {
    const withGhost = rows('a', 'ghost:gone', 'b')
    const next = selectWithModifiers(state('a', ['a']), 'b', RANGE, withGhost, false)
    expect([...next.selectedIds]).toEqual(['a', 'b'])
  })

  it('falls back to a single selection when the anchor is not visible', () => {
    const next = selectWithModifiers(state('hidden', ['hidden']), 'b', RANGE, visible, false)
    expect(next).toEqual(singleSelection('b'))
  })

  it('treats a range click with nothing selected as a toggle', () => {
    const next = selectWithModifiers(state(null, [], [], null), 'b', RANGE, visible, false)
    expect(next).toEqual(state('b', ['b'], ['b'], 'b'))
  })
})

describe('pruneSelection', () => {
  it('drops deleted ids from the set, recency, and anchor but leaves the primary alone', () => {
    const current = state('gone', ['a', 'gone'], ['a', 'gone'], 'gone')
    const next = pruneSelection(current, new Set(['a']))
    expect(next).toEqual(state('gone', ['a'], ['a'], null))
  })
})
