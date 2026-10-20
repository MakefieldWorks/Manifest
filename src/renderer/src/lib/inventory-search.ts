// Pure helpers for the inventory search bar: which tree rows stay visible
// while a search or filter is active, and the count on the Filter button.

import type { ManifestNode, SearchResult } from '../../../shared/types'
import { hasPropertyPredicate, type InventoryFilters } from '../../../shared/inventory-filters'

/**
 * Every matched node plus all of its ancestors, so the filtered tree still
 * shows the path down to each match.
 */
export function searchRevealIds(nodes: Pick<ManifestNode, 'id' | 'parentId'>[], results: Pick<SearchResult, 'nodeId'>[]): Set<string> {
  const parentMap = new Map(nodes.map(n => [n.id, n.parentId]))
  const ids = new Set<string>()
  for (const result of results) {
    ids.add(result.nodeId)
    let current = parentMap.get(result.nodeId) ?? null
    while (current !== null) {
      ids.add(current)
      current = parentMap.get(current) ?? null
    }
  }
  return ids
}

/** How many filter groups are set; a property predicate counts once. */
export function inventoryFilterCount(filters: InventoryFilters): number {
  return [
    filters.subtreeId,
    filters.templateId,
    hasPropertyPredicate(filters),
    filters.missingRequired,
  ].filter(Boolean).length
}
