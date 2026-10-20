// Tree selection model: the primary node, the multi-selection set, the order
// nodes were added (so removing the primary falls back to the most recent
// remaining one), and the anchor for Shift+click ranges.
//
// These are pure transitions. App.svelte owns the four runes and the side
// effects around them (scroll alignment, the stashed compare-mode ghost
// selection, closing the inline add-child form); it calls a transition and
// assigns the result back.

export interface SelectionState {
  selectedId: string | null
  selectedIds: Set<string>
  selectionRecency: string[]
  selectionAnchorId: string | null
}

export interface SelectModifiers {
  toggle: boolean
  range: boolean
}

/** A visible tree row, as far as range selection needs to know. */
export interface SelectableRow {
  id: string
  node: { id: string }
}

/** Replace the selection with a single node (or nothing). */
export function singleSelection(id: string | null): SelectionState {
  return {
    selectedId: id,
    selectedIds: id ? new Set([id]) : new Set(),
    selectionRecency: id ? [id] : [],
    selectionAnchorId: id,
  }
}

/**
 * Apply a click on `id` with optional Cmd/Ctrl (toggle) or Shift (range)
 * modifiers. Compare mode and ghost rows always single-select, because a
 * batch edit cannot target a snapshot.
 *
 * `rows` is read only for a range click, so callers may pass the full visible
 * row list without filtering it first.
 */
export function selectWithModifiers(
  current: SelectionState,
  id: string,
  modifiers: SelectModifiers | undefined,
  rows: readonly SelectableRow[],
  compareMode: boolean,
): SelectionState {
  if (compareMode || id.startsWith('ghost:') || (!modifiers?.toggle && !modifiers?.range)) {
    return singleSelection(id)
  }
  if (modifiers.range && current.selectedId) {
    const visibleIds = rows.filter(row => !row.id.startsWith('ghost:')).map(row => row.node.id)
    const anchor = visibleIds.indexOf(current.selectionAnchorId ?? current.selectedId)
    const target = visibleIds.indexOf(id)
    if (anchor < 0 || target < 0) return singleSelection(id)
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    const selectedIds = new Set(visibleIds.slice(start, end + 1))
    return {
      selectedId: id,
      selectedIds,
      selectionRecency: [...current.selectionRecency.filter(candidate => selectedIds.has(candidate) && candidate !== id), id],
      // A range click keeps the original anchor so the next Shift+click
      // extends from the same place.
      selectionAnchorId: current.selectionAnchorId,
    }
  }
  const next = new Set(current.selectedIds)
  let selectionRecency: string[]
  if (next.has(id)) {
    next.delete(id)
    selectionRecency = current.selectionRecency.filter(candidate => candidate !== id)
  } else {
    next.add(id)
    selectionRecency = [...current.selectionRecency.filter(candidate => candidate !== id), id]
  }
  const selectedId = next.has(id)
    ? id
    : [...selectionRecency].reverse().find(candidate => next.has(candidate)) ?? [...next][0] ?? null
  return { selectedId, selectedIds: next, selectionRecency, selectionAnchorId: selectedId }
}

/**
 * Drop ids that no longer exist after a project mutation. The primary
 * `selectedId` is left alone: App decides separately whether it fell out and
 * should fall back to the root.
 */
export function pruneSelection(current: SelectionState, liveIds: ReadonlySet<string>): SelectionState {
  return {
    selectedId: current.selectedId,
    selectedIds: new Set([...current.selectedIds].filter(id => liveIds.has(id))),
    selectionRecency: current.selectionRecency.filter(id => liveIds.has(id)),
    selectionAnchorId: current.selectionAnchorId && !liveIds.has(current.selectionAnchorId) ? null : current.selectionAnchorId,
  }
}
