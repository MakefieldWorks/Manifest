import type { ManifestNode, NodeTemplate, Project } from './types'
import type { InventoryFilters } from './inventory-filters'
import { MAX_PROPERTY_KEY_LENGTH } from './inventory-filters'

export type InventoryColumn = 'name' | 'path' | 'template' | `property:${string}`
export type InventorySortDirection = 'asc' | 'desc'

export interface InventoryTableRequest {
  query: string
  filters: InventoryFilters
  columns: InventoryColumn[]
  sortColumn: InventoryColumn
  sortDirection: InventorySortDirection
  offset?: number
  limit?: number
}

export type InventoryExportRequest = Omit<InventoryTableRequest, 'offset' | 'limit'>

export interface InventoryTableRow {
  nodeId: string
  values: Record<string, string>
}

export interface InventoryTablePage {
  rows: InventoryTableRow[]
  total: number
  offset: number
  hasMore: boolean
  propertyKeys: string[]
}

export const DEFAULT_INVENTORY_COLUMNS: InventoryColumn[] = ['name', 'path', 'template']
export const MAX_INVENTORY_COLUMNS = 12
export const INVENTORY_PROPERTY_PREFIX = 'property:'
const INVENTORY_SORT_LOCALE = 'en'

export function isInventoryColumn(value: unknown): value is InventoryColumn {
  if (value === 'name' || value === 'path' || value === 'template') return true
  return typeof value === 'string'
    && value.startsWith(INVENTORY_PROPERTY_PREFIX)
    && value.slice(INVENTORY_PROPERTY_PREFIX.length).trim().length > 0
    && value.length <= INVENTORY_PROPERTY_PREFIX.length + MAX_PROPERTY_KEY_LENGTH
}

export function inventoryColumnLabel(column: InventoryColumn): string {
  if (column === 'name') return 'Name'
  if (column === 'path') return 'Path'
  if (column === 'template') return 'Template'
  return column.slice(INVENTORY_PROPERTY_PREFIX.length)
}

export function inventoryPropertyKeys(project: Project): string[] {
  const keys = new Set<string>()
  for (const node of project.nodes) for (const key of Object.keys(node.properties)) keys.add(key)
  for (const template of Object.values(project.templates ?? {})) for (const key of Object.keys(template.fields)) keys.add(key)
  return [...keys].sort((a, b) => a.localeCompare(b)).slice(0, 500)
}

export function buildInventoryRows(
  project: Project,
  nodes: ManifestNode[],
  columns: InventoryColumn[],
): InventoryTableRow[] {
  const nodeMap = new Map(project.nodes.map(node => [node.id, node]))
  const pathCache = new Map<string, string>()
  const pathFor = (node: ManifestNode): string => {
    const cached = pathCache.get(node.id)
    if (cached !== undefined) return cached
    const names = [node.name]
    const seen = new Set([node.id])
    let parentId = node.parentId
    while (parentId) {
      if (seen.has(parentId)) break
      seen.add(parentId)
      const parent = nodeMap.get(parentId)
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId
    }
    const path = names.join(' / ')
    pathCache.set(node.id, path)
    return path
  }

  return nodes.map(node => {
    const values: Record<string, string> = {}
    for (const column of columns) values[column] = inventoryCellValue(node, project.templates, column, pathFor(node))
    return { nodeId: node.id, values }
  })
}

export function sortInventoryRows(
  rows: InventoryTableRow[],
  column: InventoryColumn,
  direction: InventorySortDirection,
): InventoryTableRow[] {
  const multiplier = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const compared = (a.values[column] ?? '').localeCompare(b.values[column] ?? '', INVENTORY_SORT_LOCALE, { numeric: true, sensitivity: 'base' })
    return compared !== 0
      ? compared * multiplier
      : a.nodeId.localeCompare(b.nodeId, INVENTORY_SORT_LOCALE, { sensitivity: 'base' })
  })
}

function inventoryCellValue(
  node: ManifestNode,
  templates: Record<string, NodeTemplate> | undefined,
  column: InventoryColumn,
  path: string,
): string {
  if (column === 'name') return node.name
  if (column === 'path') return path
  if (column === 'template') return node.templateId ? templates?.[node.templateId]?.label ?? node.templateId : ''
  const value = node.properties[column.slice(INVENTORY_PROPERTY_PREFIX.length)]
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}
