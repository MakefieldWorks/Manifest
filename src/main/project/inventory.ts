// Inventory table and CSV export: validate the renderer's request, then shape
// already-selected nodes into sorted rows, pages, or CSV. Node selection
// (which may hit the search index) stays in ProjectManager.

import type { ManifestNode, Project, Result } from '../../shared/types'
import { ok, err, ErrorCode } from '../../shared/errors'
import { serializeCsv } from '../../shared/csv'
import { validateInventoryFilters } from '../../shared/inventory-filters'
import {
  buildInventoryRows,
  DEFAULT_INVENTORY_COLUMNS,
  inventoryColumnLabel,
  inventoryPropertyKeys,
  isInventoryColumn,
  MAX_INVENTORY_COLUMNS,
  sortInventoryRows,
  type InventoryColumn,
  type InventorySortDirection,
  type InventoryTablePage,
  type InventoryTableRequest,
  type InventoryTableRow,
} from '../../shared/inventory-table'
import { normalizeSearchPage } from '../search-index'

export interface PreparedInventoryTable {
  request: InventoryTableRequest
  rows: InventoryTableRow[]
  propertyKeys: string[]
}

export function normalizeInventoryTableRequest(project: Project | null, rawRequest: unknown): Result<InventoryTableRequest> {
  if (!project) return err(ErrorCode.PROJECT_NOT_FOUND, 'No project is open.')
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return err(ErrorCode.VALIDATION_FAILED, 'Inventory table request must be an object.')
  }
  const candidate = rawRequest as Record<string, unknown>
  if (typeof candidate.query !== 'string' || candidate.query.length > 512) {
    return err(ErrorCode.VALIDATION_FAILED, 'Inventory query must be a string of at most 512 characters.')
  }
  const filterCheck = validateInventoryFilters(candidate.filters)
  if (!filterCheck.valid) return err(ErrorCode.VALIDATION_FAILED, filterCheck.message)
  if (!Array.isArray(candidate.columns) || !candidate.columns.every(isInventoryColumn)) {
    return err(ErrorCode.VALIDATION_FAILED, `Choose between 1 and ${MAX_INVENTORY_COLUMNS} valid inventory columns.`)
  }
  const columns = [...new Set(candidate.columns as InventoryColumn[])]
  if (columns.length === 0 || columns.length > MAX_INVENTORY_COLUMNS) {
    return err(ErrorCode.VALIDATION_FAILED, `Choose between 1 and ${MAX_INVENTORY_COLUMNS} valid inventory columns.`)
  }
  if (candidate.sortColumn !== undefined && !isInventoryColumn(candidate.sortColumn)) {
    return err(ErrorCode.VALIDATION_FAILED, 'Inventory sort column is invalid.')
  }
  if (candidate.sortDirection !== undefined && candidate.sortDirection !== 'asc' && candidate.sortDirection !== 'desc') {
    return err(ErrorCode.VALIDATION_FAILED, 'Inventory sort direction must be asc or desc.')
  }
  const sortColumn = candidate.sortColumn as InventoryColumn | undefined ?? columns[0] ?? DEFAULT_INVENTORY_COLUMNS[0]
  const sortDirection: InventorySortDirection = candidate.sortDirection === 'desc' ? 'desc' : 'asc'
  const request: InventoryTableRequest = {
    query: candidate.query.trim(),
    filters: filterCheck.filters,
    columns,
    sortColumn,
    sortDirection,
    offset: typeof candidate.offset === 'number' ? candidate.offset : 0,
    limit: typeof candidate.limit === 'number' ? candidate.limit : 50,
  }

  return ok(request)
}

// Rows carry the sort column even when it is not displayed.
export function buildSortedInventory(project: Project, nodes: ManifestNode[], request: InventoryTableRequest): PreparedInventoryTable {
  const rowColumns = request.columns.includes(request.sortColumn)
    ? request.columns
    : [...request.columns, request.sortColumn]
  const rows = sortInventoryRows(buildInventoryRows(project, nodes, rowColumns), request.sortColumn, request.sortDirection)
  return { request, rows, propertyKeys: inventoryPropertyKeys(project) }
}

export function inventoryPage({ request, rows, propertyKeys }: PreparedInventoryTable): InventoryTablePage {
  const { offset, limit } = normalizeSearchPage(request.offset, request.limit)
  const pageRows = rows.slice(offset, offset + limit).map(row => ({
    nodeId: row.nodeId,
    values: Object.fromEntries(request.columns.map(column => [column, row.values[column] ?? ''])),
  }))
  return {
    rows: pageRows,
    total: rows.length,
    offset,
    hasMore: offset + pageRows.length < rows.length,
    propertyKeys,
  }
}

export function inventoryCsvContent({ request, rows }: PreparedInventoryTable): string {
  const headers = request.columns.map(inventoryColumnLabel)
  return serializeCsv([
    headers,
    ...rows.map(row => request.columns.map(column => row.values[column] ?? '')),
  ])
}

export function inventoryCsvSuggestedName(project: Project | null): string {
  const projectName = project?.name.trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'manifest'
  return `${projectName}-inventory.csv`
}
