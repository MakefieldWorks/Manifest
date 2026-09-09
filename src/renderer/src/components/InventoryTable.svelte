<svelte:options runes />

<script lang="ts">
  import { untrack } from 'svelte'
  import type { Project } from '../../../shared/types'
  import type { InventoryFilters } from '../../../shared/inventory-filters'
  import {
    DEFAULT_INVENTORY_COLUMNS,
    MAX_INVENTORY_COLUMNS,
    type InventoryColumn,
    type InventorySortDirection,
    type InventoryTableRequest,
    type InventoryTableRow,
  } from '../../../shared/inventory-table'

  interface Props {
    project: Project
    query: string
    filters: InventoryFilters
    selectedId: string | null
    onSelect: (id: string) => void
    onMessage: (message: string) => void
    columns?: InventoryColumn[]
    sortColumn?: InventoryColumn
    sortDirection?: InventorySortDirection
  }

  let {
    project, query, filters, selectedId, onSelect, onMessage,
    columns = $bindable<InventoryColumn[]>([...DEFAULT_INVENTORY_COLUMNS]),
    sortColumn = $bindable<InventoryColumn>('name'),
    sortDirection = $bindable<InventorySortDirection>('asc'),
  }: Props = $props()
  let rows = $state<InventoryTableRow[]>([])
  let total = $state(0)
  let hasMore = $state(false)
  let propertyKeys = $state<string[]>([])
  let propertyToAdd = $state('')
  let loading = $state(false)
  let loadingMore = $state(false)
  let exporting = $state(false)
  let requestSerial = 0
  const pageSize = 100

  const signature = $derived(JSON.stringify({ path: project.path, modified: project.modified, query, filters, columns, sortColumn, sortDirection }))

  $effect(() => {
    signature
    void untrack(() => loadPage(false))
  })

  function request(offset = 0): InventoryTableRequest {
    return { query, filters: { ...filters }, columns: [...columns], sortColumn, sortDirection, offset, limit: pageSize }
  }

  async function loadPage(append: boolean): Promise<void> {
    const serial = ++requestSerial
    if (append) loadingMore = true
    else loading = true
    const offset = append ? rows.length : 0
    const result = await window.api.inventory.query(request(offset)).catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'INVENTORY_QUERY_FAILED', message: error instanceof Error ? error.message : String(error) },
    }))
    if (serial !== requestSerial) return
    loading = false
    loadingMore = false
    if (!result.ok) {
      onMessage(result.error.message)
      return
    }
    rows = append ? [...rows, ...result.data.rows] : result.data.rows
    total = result.data.total
    hasMore = result.data.hasMore
    propertyKeys = result.data.propertyKeys
  }

  function sortBy(column: InventoryColumn): void {
    if (sortColumn === column) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    else {
      sortColumn = column
      sortDirection = 'asc'
    }
  }

  function addPropertyColumn(): void {
    if (!propertyToAdd) return
    const column = `property:${propertyToAdd}` as InventoryColumn
    if (!columns.includes(column)) columns = [...columns, column]
    propertyToAdd = ''
  }

  function removeColumn(column: InventoryColumn): void {
    if (columns.length === 1) return
    columns = columns.filter(candidate => candidate !== column)
    if (sortColumn === column) sortColumn = columns[0]
  }

  async function exportCsv(): Promise<void> {
    if (exporting) return
    exporting = true
    try {
      const result = await window.api.inventory.exportCsv(request(0)).catch((error: unknown) => ({
        ok: false as const,
        error: { code: 'INVENTORY_EXPORT_FAILED', message: error instanceof Error ? error.message : String(error) },
      }))
      if (!result.ok) onMessage(result.error.message)
      else if (result.data.savedPath) onMessage(`Exported ${result.data.rowCount} inventory rows.`)
    } finally {
      exporting = false
    }
  }

  function label(column: InventoryColumn): string {
    if (column === 'name') return 'Name'
    if (column === 'path') return 'Path'
    if (column === 'template') return 'Template'
    return column.slice(9)
  }
</script>

<div class="flex h-full flex-col overflow-hidden bg-white" data-testid="inventory-table">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
    <div>
      <p class="text-xs font-semibold text-stone-700">{loading ? 'Loading inventory…' : `${total} ${total === 1 ? 'node' : 'nodes'}`}</p>
      {#if rows.length < total}<p class="text-[10px] text-stone-400">{rows.length} loaded</p>{/if}
    </div>
    <div class="flex items-center gap-1.5">
      <select
        class="rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600"
        bind:value={propertyToAdd}
        aria-label="Property column"
        data-testid="inventory-column-picker"
      >
        <option value="">Add property column…</option>
        {#each propertyKeys.filter(key => columns.length < MAX_INVENTORY_COLUMNS && !columns.includes(`property:${key}`)) as key (key)}
          <option value={key}>{key}</option>
        {/each}
      </select>
      <button class="rounded border border-stone-200 px-2 py-1 text-xs text-stone-600 disabled:text-stone-300" disabled={!propertyToAdd || columns.length >= MAX_INVENTORY_COLUMNS} onclick={addPropertyColumn} data-testid="inventory-column-add">Add</button>
      <button
        class="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white disabled:bg-stone-300"
        disabled={loading || exporting}
        onclick={() => void exportCsv()}
        data-testid="inventory-export-csv"
      >{exporting ? 'Exporting…' : 'Export CSV'}</button>
    </div>
  </div>

  <div class="flex-1 overflow-auto">
    <table class="min-w-full border-collapse text-left text-xs">
      <thead class="sticky top-0 z-10 bg-stone-50 text-stone-500">
        <tr>
          {#each columns as column (column)}
            <th class="border-b border-r border-stone-200 px-3 py-2 font-medium">
              <div class="flex items-center gap-1">
                <button class="truncate hover:text-stone-900" onclick={() => sortBy(column)} data-testid={`inventory-sort-${column}`}>
                  {label(column)}{sortColumn === column ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
                {#if column.startsWith('property:')}
                  <button class="text-stone-300 hover:text-stone-600" aria-label={`Remove ${label(column)} column`} onclick={() => removeColumn(column)}>×</button>
                {/if}
              </div>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.nodeId)}
          <tr
            class="cursor-default border-b border-stone-100 hover:bg-stone-50"
            class:bg-sky-50={selectedId === row.nodeId}
            onclick={() => onSelect(row.nodeId)}
            data-testid="inventory-row"
            data-node-id={row.nodeId}
          >
            {#each columns as column (column)}
              <td class="max-w-72 truncate border-r border-stone-100 px-3 py-2 text-stone-700" title={row.values[column]}>{row.values[column] || '—'}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !loading && rows.length === 0}
      <p class="p-4 text-sm text-stone-400">No matching nodes</p>
    {/if}
  </div>

  {#if hasMore}
    <div class="border-t border-stone-200 p-2 text-center">
      <button class="text-xs font-medium text-stone-600 hover:text-stone-900 disabled:text-stone-300" disabled={loadingMore} onclick={() => void loadPage(true)} data-testid="inventory-load-more">
        {loadingMore ? 'Loading…' : `Load more (${rows.length} of ${total})`}
      </button>
    </div>
  {/if}
</div>
