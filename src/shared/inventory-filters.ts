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

export type InventoryFilterValidation =
  | { valid: true; filters: InventoryFilters }
  | { valid: false; message: string }

const MAX_FILTER_ID_LENGTH = 200
const MAX_PROPERTY_KEY_LENGTH = 64
const MAX_PROPERTY_VALUE_LENGTH = 512

export function hasPropertyPredicate(filters: InventoryFilters): boolean {
  return Boolean(filters.propertyKey?.trim() && filters.propertyValue?.trim())
}

export function hasInventoryFilters(filters: InventoryFilters): boolean {
  return Boolean(
    filters.subtreeId ||
    filters.templateId ||
    hasPropertyPredicate(filters) ||
    filters.missingRequired
  )
}

export function validateInventoryFilters(input: unknown): InventoryFilterValidation {
  if (input === undefined) return { valid: true, filters: {} }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, message: 'Inventory filters must be an object.' }
  }
  const candidate = input as Record<string, unknown>
  const fields: Array<[keyof InventoryFilters, number]> = [
    ['subtreeId', MAX_FILTER_ID_LENGTH],
    ['templateId', MAX_FILTER_ID_LENGTH],
    ['propertyKey', MAX_PROPERTY_KEY_LENGTH],
    ['propertyValue', MAX_PROPERTY_VALUE_LENGTH],
  ]
  for (const [field, maximum] of fields) {
    const value = candidate[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { valid: false, message: `${field} must be text.` }
    }
    if (typeof value === 'string' && value.length > maximum) {
      return { valid: false, message: `${field} cannot exceed ${maximum} characters.` }
    }
  }
  if (candidate.missingRequired !== undefined && typeof candidate.missingRequired !== 'boolean') {
    return { valid: false, message: 'missingRequired must be true or false.' }
  }

  const filters: InventoryFilters = {}
  const subtreeId = stringValue(candidate.subtreeId)
  const templateId = stringValue(candidate.templateId)
  const propertyKey = stringValue(candidate.propertyKey)
  const propertyValue = stringValue(candidate.propertyValue, false)
  if (subtreeId) filters.subtreeId = subtreeId
  if (templateId) filters.templateId = templateId
  if (propertyKey) filters.propertyKey = propertyKey
  if (propertyValue !== undefined) filters.propertyValue = propertyValue
  filters.propertyOperator = candidate.propertyOperator === 'contains' ? 'contains' : 'equals'
  if (candidate.missingRequired === true) filters.missingRequired = true
  return { valid: true, filters }
}

export function filterInventoryNodes(project: Project, filters: InventoryFilters): ManifestNode[] {
  if (!hasInventoryFilters(filters)) return project.nodes

  const subtreeIds = filters.subtreeId
    ? project.nodes.some(node => node.id === filters.subtreeId)
      ? collectSubtreeIds(project.nodes, filters.subtreeId)
      : new Set<string>()
    : null
  const propertyActive = hasPropertyPredicate(filters)
  const propertyKey = propertyActive ? filters.propertyKey!.trim() : ''
  const propertyValue = propertyActive ? filters.propertyValue!.trim().toLocaleLowerCase() : ''
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
  const propertyKey = hasPropertyPredicate(filters) ? filters.propertyKey!.trim() : ''
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

function stringValue(value: unknown, trim = true): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = trim ? value.trim() : value
  return normalized || undefined
}
