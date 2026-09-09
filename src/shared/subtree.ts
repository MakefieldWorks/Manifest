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

/** Build a reusable, cycle-safe resolver for a node's full display path. */
export function buildNodePathResolver(nodes: ManifestNode[]): (nodeId: string) => string | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  return (nodeId: string) => {
    const node = byId.get(nodeId)
    if (!node) return null

    const names = [node.name]
    const visited = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) break
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId
    }
    return names.join(' / ')
  }
}
