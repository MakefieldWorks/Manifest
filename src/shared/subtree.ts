import type { ManifestNode } from './types'

/** Iterative traversal is linear in project size and safe for deep hierarchies. */
export function collectSubtreeIds(nodes: ManifestNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentId === null) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node.id)
    children.set(node.parentId, siblings)
  }
  const result = new Set<string>()
  const pending = [rootId]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (result.has(id)) continue
    result.add(id)
    for (const child of children.get(id) ?? []) pending.push(child)
  }
  return result
}
