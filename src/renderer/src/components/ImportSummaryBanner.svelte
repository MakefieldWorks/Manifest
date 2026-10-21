<svelte:options runes />

<script lang="ts">
  import type { ImportResult } from '../../../shared/types'

  interface Props {
    summary: ImportResult
    onDismiss: () => void
  }

  let { summary: importSummary, onDismiss }: Props = $props()
</script>

<div
  class="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900"
  data-testid="import-summary-banner"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="font-semibold">
        Imported {importSummary.created} node{importSummary.created === 1 ? '' : 's'}
        {#if importSummary.updated > 0}<span class="font-normal text-emerald-800"> · {importSummary.updated} updated</span>{/if}
        {#if importSummary.createdParents > 0}<span class="font-normal text-emerald-800"> · {importSummary.createdParents} parent{importSummary.createdParents === 1 ? '' : 's'} created</span>{/if}
        {#if importSummary.skippedCount > 0}<span class="font-normal text-emerald-800"> · {importSummary.skippedCount} skipped</span>{/if}
        {#if importSummary.warningCount > 0}<span class="font-normal text-amber-700"> · {importSummary.warningCount} warnings</span>{/if}
      </p>
      {#if importSummary.skipped.length > 0}
        <ul class="mt-1 space-y-0.5">
          {#each importSummary.skipped.slice(0, 5) as s (s.row + (s.column ?? ''))}
            <li class="truncate text-emerald-800">row {s.row}{s.column ? ` · ${s.column}` : ''} — {s.reason}</li>
          {/each}
          {#if importSummary.skippedCount > 5}
            <li class="text-emerald-700">…and {importSummary.skippedCount - 5} more</li>
          {/if}
        </ul>
      {/if}
    </div>
    <button
      onclick={onDismiss}
      class="shrink-0 text-emerald-700 hover:text-emerald-900 cursor-default"
      aria-label="Dismiss import summary"
      data-testid="dismiss-import-summary"
    >✕</button>
  </div>
</div>
