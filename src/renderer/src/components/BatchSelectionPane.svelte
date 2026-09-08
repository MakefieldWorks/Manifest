<svelte:options runes />

<script lang="ts">
  import type { ManifestNode } from '../../../shared/types'

  interface Props {
    nodes: ManifestNode[]
    primaryName: string
    readOnly?: boolean
    onEdit: () => void
    onClear: () => void
  }

  let { nodes, primaryName, readOnly = false, onEdit, onClear }: Props = $props()
</script>

<section class="h-full overflow-auto bg-white p-5" data-testid="batch-selection-pane">
  <div class="mx-auto max-w-xl">
    <p class="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Multiple selection</p>
    <h2 class="mt-1 text-lg font-semibold text-stone-800">{nodes.length} nodes selected</h2>
    <p class="mt-2 text-sm text-stone-500">
      Set or clear one property across this exact selection. You will review every affected node before applying it.
    </p>
    <p class="mt-2 text-xs text-stone-400">Cmd/Ctrl-click toggles one node. Shift-click selects a visible range.</p>
    <div class="mt-4 max-h-64 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-2">
      {#each nodes as node (node.id)}
        <div class="truncate rounded px-2 py-1 text-sm text-stone-700" title={node.name}>{node.name}</div>
      {/each}
    </div>
    <div class="mt-4 flex gap-2">
      <button
        type="button"
        onclick={onEdit}
        disabled={readOnly}
        class="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:bg-stone-300"
        data-testid="batch-edit-open"
      >Edit properties…</button>
      <button type="button" onclick={onClear} class="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">
        Keep only {primaryName}
      </button>
    </div>
  </div>
</section>
