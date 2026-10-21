<svelte:options runes />

<script lang="ts">
  import type { Project } from '../../../shared/types'
  import type { InventoryFilters } from '../../../shared/inventory-filters'
  import InventoryFilterPanel from './InventoryFilterPanel.svelte'

  // Search input, filter toggle, Tree/Table switch, and result status for the
  // left pane. The parent owns the query, results, and request sequencing;
  // this component renders them and reports input.
  interface Props {
    project: Project
    selectedId: string | null
    query: string
    filters: InventoryFilters
    filtersActive: boolean
    filterCount: number
    compareMode: boolean
    /** A query or filter is set. */
    active: boolean
    searching: boolean
    loadedCount: number
    resultIndex: number
    total: number
    hasMore: boolean
    loadingMore: boolean
    /** Bound so the parent can focus the input (Cmd/Ctrl+F, tree type-ahead). */
    inputEl: HTMLInputElement | null
    filtersOpen: boolean
    viewMode: 'tree' | 'table'
    onInput: (e: Event) => void
    onKeydown: (e: KeyboardEvent) => void
    onClearQuery: () => void
    onFiltersChange: (filters: InventoryFilters) => void
    onLoadMore: () => void
  }

  let {
    project, selectedId, query, filters, filtersActive, filterCount, compareMode, active, searching,
    loadedCount, resultIndex, total, hasMore, loadingMore,
    inputEl = $bindable(), filtersOpen = $bindable(), viewMode = $bindable(),
    onInput, onKeydown, onClearQuery, onFiltersChange, onLoadMore,
  }: Props = $props()
</script>

<div class="px-3 py-2 border-b border-stone-200">
  <div class="flex gap-1.5">
    <div class="relative min-w-0 flex-1">
      <input
        bind:this={inputEl}
        type="text"
        value={query}
        oninput={onInput}
        onkeydown={onKeydown}
        placeholder="Search nodes…"
        class="w-full bg-white border border-stone-200 rounded-lg pl-8 pr-8 py-1.5
               text-sm text-stone-700 placeholder-stone-300 focus:outline-none
               focus:ring-1 focus:ring-stone-400 selectable"
        data-testid="search-input"
      />
      <svg class="absolute left-2.5 top-2 w-3.5 h-3.5 text-stone-400" fill="none" viewBox="0 0 16 16">
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {#if query}
        <button
          class="absolute right-2.5 top-1.5 text-stone-400 hover:text-stone-600 text-xs"
          onclick={onClearQuery}
          aria-label="Clear search text"
        >✕</button>
      {/if}
    </div>
    <button
      type="button"
      class="rounded-lg border px-2 py-1.5 text-xs font-medium"
      class:border-stone-700={filtersOpen || filtersActive}
      class:bg-stone-800={filtersOpen || filtersActive}
      class:text-white={filtersOpen || filtersActive}
      class:border-stone-200={!filtersOpen && !filtersActive}
      class:bg-white={!filtersOpen && !filtersActive}
      class:text-stone-600={!filtersOpen && !filtersActive}
      disabled={compareMode}
      aria-expanded={filtersOpen}
      onclick={() => { filtersOpen = !filtersOpen }}
      data-testid="inventory-filter-toggle"
    >Filter{filterCount ? ` ${filterCount}` : ''}</button>
    <div class="flex rounded-lg border border-stone-200 bg-white p-0.5" aria-label="Inventory view">
      <button
        type="button"
        class="rounded px-1.5 py-1 text-[10px] font-medium"
        class:bg-stone-800={viewMode === 'tree'}
        class:text-white={viewMode === 'tree'}
        class:text-stone-500={viewMode !== 'tree'}
        onclick={() => { viewMode = 'tree' }}
        data-testid="inventory-view-tree"
      >Tree</button>
      <button
        type="button"
        class="rounded px-1.5 py-1 text-[10px] font-medium"
        class:bg-stone-800={viewMode === 'table'}
        class:text-white={viewMode === 'table'}
        class:text-stone-500={viewMode !== 'table'}
        disabled={compareMode}
        onclick={() => { viewMode = 'table' }}
        data-testid="inventory-view-table"
      >Table</button>
    </div>
  </div>
  {#if filtersOpen && !compareMode}
    <InventoryFilterPanel
      {project}
      {selectedId}
      {filters}
      onChange={onFiltersChange}
    />
  {/if}
  {#if active}
    <div class="mt-2 flex items-center justify-between gap-2">
      <p class="truncate text-xs text-stone-500">
        {#if searching}
          Searching…
        {:else if loadedCount === 0}
          {query.trim() ? `No results for "${query}"` : 'No nodes match these filters'}
        {:else}
          Result {resultIndex + 1} of {total}{query.trim() ? ` for "${query}"` : ''}
          {#if loadedCount < total} · {loadedCount} loaded{/if}
        {/if}
      </p>
      {#if loadedCount > 1}
        <span class="shrink-0 text-[10px] text-stone-400">Enter next · Shift+Enter prev</span>
      {/if}
    </div>
    {#if hasMore}
      <button
        class="mt-1 text-xs font-medium text-stone-600 hover:text-stone-900 disabled:text-stone-300"
        disabled={loadingMore}
        onclick={onLoadMore}
        data-testid="search-load-more"
      >{loadingMore ? 'Loading…' : `Load more results (${loadedCount} of ${total})`}</button>
    {/if}
  {/if}
</div>
