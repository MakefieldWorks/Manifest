// Pure helpers for entering and navigating snapshot compare mode. Compare mode
// shows a merged tree in which removed and moved-from nodes appear as
// `ghost:<id>` rows; these helpers decide what is expanded and which row a
// selection lands on.

import type { ManifestNode } from '../../../shared/types'
import type { MergedTreeNode } from '../../../shared/merged-tree'
import { getAncestorIds } from './tree'

/**
 * Expansion to show when a comparison loads: whatever the user had open in
 * browse mode, plus every changed node and its ancestors so no change is
 * hidden inside a collapsed parent.
 */
export function seedCompareExpanded(browseExpanded: Iterable<string>, nodes: MergedTreeNode[]): Set<string> {
  const ancestors = new Set<string>()
  for (const node of nodes) {
    if (node.status === 'unchanged') continue
    for (const aid of getAncestorIds(node.id, nodes)) ancestors.add(aid)
    ancestors.add(node.id)
  }
  return new Set([...browseExpanded, ...ancestors])
}

/**
 * The row id for a node in the merged tree: the live id when the node exists
 * on the "to" side, its ghost id when only the removed copy exists, and the
 * original id otherwise.
 */
export function resolveCompareSelectionId(nodeId: string, nodes: ManifestNode[]): string {
  if (nodes.some(node => node.id === nodeId)) return nodeId
  const ghostId = `ghost:${nodeId}`
  if (nodes.some(node => node.id === ghostId)) return ghostId
  return nodeId
}

/**
 * Like resolveCompareSelectionId, but for a comparison scope root, which is
 * always present on one side or the other.
 */
export function scopeSelectionId(scopeNodeId: string, nodes: ManifestNode[]): string {
  return nodes.some(node => node.id === scopeNodeId) ? scopeNodeId : `ghost:${scopeNodeId}`
}

/** Add a node and all of its ancestors to an expansion set. */
export function expandToReveal(expanded: Iterable<string>, nodeId: string, nodes: ManifestNode[]): Set<string> {
  return new Set([...expanded, ...getAncestorIds(nodeId, nodes), nodeId])
}
