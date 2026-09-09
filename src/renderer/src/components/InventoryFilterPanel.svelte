<svelte:options runes />

<script lang="ts">
  import type { Project } from '../../../shared/types'
  import type { InventoryFilters, PropertyFilterOperator } from '../../../shared/inventory-filters'

  interface Props {
    project: Project
    selectedId: string | null
    filters: InventoryFilters
    onChange: (filters: InventoryFilters) => void
  }

  let { project, selectedId, filters, onChange }: Props = $props()

  const selectedNode = $derived(project.nodes.find(node => node.id === selectedId) ?? null)
  const subtreeNode = $derived(project.nodes.find(node => node.id === filters.subtreeId) ?? null)
  const templateEntries = $derived(Object.entries(project.templates ?? {}).sort((a, b) => a[1].label.localeCompare(b[1].label)))
  const propertyKeys = $derived.by(() => {
    const keys = new Set<string>()
    for (const node of project.nodes) for (const key of Object.keys(node.properties)) keys.add(key)
    for (const template of Object.values(project.templates ?? {})) for (const key of Object.keys(template.fields)) keys.add(key)
    return [...keys].sort((a, b) => a.localeCompare(b))
  })

  function update(patch: Partial<InventoryFilters>): void {
    onChange({ ...filters, ...patch })
  }
</script>

<div class="mt-2 space-y-2 rounded-lg border border-stone-200 bg-white p-2.5" data-testid="inventory-filter-panel">
  <div class="flex items-center justify-between gap-2">
    <p class="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Inventory filters</p>
    <button
      type="button"
      class="text-[10px] font-medium text-stone-500 hover:text-stone-800"
      onclick={() => onChange({})}
      data-testid="inventory-filter-clear"
    >Clear all</button>
  </div>

  <div>
    <p class="text-[10px] text-stone-500">Scope</p>
    <div class="mt-1 flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-xs text-stone-700" title={subtreeNode?.name ?? 'Entire project'}>
        {subtreeNode ? subtreeNode.name : 'Entire project'}
      </span>
      {#if filters.subtreeId}
        <button type="button" class="text-[10px] text-stone-500 hover:text-stone-800" onclick={() => update({ subtreeId: null })}>Entire project</button>
      {:else}
        <button
          type="button"
          class="text-[10px] text-stone-500 hover:text-stone-800 disabled:text-stone-300"
          disabled={!selectedNode}
          onclick={() => selectedNode && update({ subtreeId: selectedNode.id })}
          data-testid="inventory-filter-use-selection"
        >Use selected</button>
      {/if}
    </div>
  </div>

  <label class="block text-[10px] text-stone-500">
    Template
    <select
      class="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700"
      value={filters.templateId ?? ''}
      onchange={(event) => update({ templateId: (event.currentTarget as HTMLSelectElement).value || null })}
      data-testid="inventory-filter-template"
    >
      <option value="">Any template</option>
      {#each templateEntries as [id, template] (id)}
        <option value={id}>{template.label}</option>
      {/each}
    </select>
  </label>

  <div class="grid grid-cols-[1fr_auto] gap-1.5">
    <label class="block text-[10px] text-stone-500">
      Property
      <input
        list="inventory-property-keys"
        class="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 text-xs text-stone-700"
        value={filters.propertyKey ?? ''}
        oninput={(event) => update({ propertyKey: (event.currentTarget as HTMLInputElement).value })}
        placeholder="Property key"
        data-testid="inventory-filter-property-key"
      />
      <datalist id="inventory-property-keys">
        {#each propertyKeys as key (key)}<option value={key}></option>{/each}
      </datalist>
    </label>
    <label class="block text-[10px] text-stone-500">
      Match
      <select
        class="mt-1 rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700"
        value={filters.propertyOperator ?? 'equals'}
        onchange={(event) => update({ propertyOperator: (event.currentTarget as HTMLSelectElement).value as PropertyFilterOperator })}
        data-testid="inventory-filter-property-operator"
      >
        <option value="equals">equals</option>
        <option value="contains">contains</option>
      </select>
    </label>
  </div>

  {#if filters.propertyKey?.trim()}
    <label class="block text-[10px] text-stone-500">
      Value
      <input
        class="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 text-xs text-stone-700"
        value={filters.propertyValue ?? ''}
        oninput={(event) => update({ propertyValue: (event.currentTarget as HTMLInputElement).value })}
        placeholder="Value"
        data-testid="inventory-filter-property-value"
      />
    </label>
  {/if}

  <label class="flex items-center gap-2 text-xs text-stone-600">
    <input
      type="checkbox"
      checked={filters.missingRequired ?? false}
      onchange={(event) => update({ missingRequired: (event.currentTarget as HTMLInputElement).checked })}
      data-testid="inventory-filter-missing-required"
    />
    Missing a required value
  </label>
</div>
