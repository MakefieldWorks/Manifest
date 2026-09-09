import type { ComparisonScope, DiffEntry, Project, TemplateDiffEntry } from './types'
import { buildNodePathResolver, collectSubtreeIds } from './subtree'

export interface ComparisonScopeResult {
  scope: ComparisonScope
  nodeIds: Set<string>
}

export function resolveComparisonScope(
  from: Project,
  to: Project,
  nodeId: string,
): ComparisonScopeResult | null {
  const fromNode = from.nodes.find(node => node.id === nodeId)
  const toNode = to.nodes.find(node => node.id === nodeId)
  const displayNode = toNode ?? fromNode
  if (!displayNode) return null

  return {
    scope: {
      nodeId,
      name: displayNode.name,
      path: buildNodePathResolver((toNode ? to : from).nodes)(nodeId) ?? displayNode.name,
    },
    nodeIds: new Set([
      ...collectSubtreeIds(from.nodes, nodeId),
      ...collectSubtreeIds(to.nodes, nodeId),
    ]),
  }
}

export function filterDiffsToComparisonScope(
  diffs: DiffEntry[],
  nodeIds: ReadonlySet<string>,
): DiffEntry[] {
  return diffs.filter(diff => nodeIds.has(diff.nodeId))
}

export function filterTemplateDiffsToComparisonScope(
  diffs: TemplateDiffEntry[],
  from: Project,
  to: Project,
  nodeIds: ReadonlySet<string>,
): TemplateDiffEntry[] {
  const templateIds = new Set<string>()
  for (const project of [from, to]) {
    for (const node of project.nodes) {
      if (nodeIds.has(node.id) && node.templateId) templateIds.add(node.templateId)
    }
  }
  return diffs.filter(diff => templateIds.has(diff.templateId))
}
