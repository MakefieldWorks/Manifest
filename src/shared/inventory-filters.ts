import type { ManifestNode, Project } from './types'
import { collectSubtreeIds } from './subtree'

export type PropertyFilterOperator = 'equals' | 'contains'

export interface InventoryFilters {
  subtreeId?: string | null
  templateId?: string | null
  propertyKey?: string
  propertyOperator?: PropertyFilterOperator
  propertyValue?: string
  missingRequired?: boolean
}

export function hasInventoryFilters(filters: InventoryFilters): boolean {
  return Boolean(
    filters.subtreeId ||
    filters.templateId ||
    filters.propertyKey?.trim() ||
    filters.missingRequired
  )
}

export function filterInventoryNodes(project: Project, filters: InventoryFilters): ManifestNode[] {
  if (!hasInventoryFilters(filters)) return project.nodes

  const subtreeIds = filters.subtreeId
    ? project.nodes.some(node => node.id === filters.subtreeId)
      ? collectSubtreeIds(project.nodes, filters.subtreeId)
      : new Set<string>()
    : null
  const propertyKey = filters.propertyKey?.trim() ?? ''
  const propertyValue = filters.propertyValue?.trim().toLocaleLowerCase() ?? ''
  const propertyOperator = filters.propertyOperator ?? 'equals'

  return project.nodes.filter(node => {
    if (subtreeIds && !subtreeIds.has(node.id)) return false
    if (filters.templateId && node.templateId !== filters.templateId) return false
    if (filters.missingRequired && !missingRequiredKeys(project, node).length) return false
    if (propertyKey) {
      const value = node.properties[propertyKey]
      if (value === undefined || value === null) return false
      const normalized = String(value).toLocaleLowerCase()
      if (propertyOperator === 'contains') {
        if (!normalized.includes(propertyValue)) return false
      } else if (normalized !== propertyValue) return false
    }
    return true
  })
}

export function inventoryFilterSnippet(
  project: Project,
  node: ManifestNode,
  filters: InventoryFilters,
): string {
  const propertyKey = filters.propertyKey?.trim()
  if (propertyKey && node.properties[propertyKey] !== undefined) {
    const value = node.properties[propertyKey]
    return `${propertyKey}: ${value === null ? 'null' : String(value)}`
  }
  if (filters.missingRequired) {
    const missing = missingRequiredKeys(project, node)
    if (missing.length > 0) return `Missing: ${missing.join(', ')}`
  }
  if (filters.templateId) {
    return `Template: ${project.templates?.[filters.templateId]?.label ?? filters.templateId}`
  }
  if (filters.subtreeId) {
    return `Within: ${project.nodes.find(candidate => candidate.id === filters.subtreeId)?.name ?? 'selected subtree'}`
  }
  return node.name
}

export function missingRequiredKeys(project: Project, node: ManifestNode): string[] {
  if (!node.templateId) return []
  const fields = project.templates?.[node.templateId]?.fields ?? {}
  return Object.entries(fields)
    .filter(([key, field]) => field.required && isMissing(node.properties[key]))
    .map(([key]) => key)
}

function isMissing(value: ManifestNode['properties'][string] | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}
