<svelte:options runes />

<script lang="ts">
  // One kind of import issue (skipped rows or warnings): the first few, with a
  // toggle to list every issue main sent. Main caps the list it sends, so a
  // note says when the total is larger than what can be shown.
  import type { ImportIssue } from '../../../shared/types'

  interface Props {
    title: string
    issues: ImportIssue[]
    total: number
    showRow: boolean
    testid: string
  }

  let { title, issues, total, showRow, testid }: Props = $props()

  const PREVIEW = 5
  let expanded = $state(false)
  const shown = $derived(expanded ? issues : issues.slice(0, PREVIEW))
</script>

{#if issues.length > 0}
  <div class="mt-1" data-testid={testid}>
    <p class="text-xs font-medium text-stone-600">{title}</p>
    <ul class="space-y-0.5 {expanded ? 'max-h-48 overflow-y-auto' : ''}">
      {#each shown as s, i (i)}
        <li class="text-xs text-stone-500 {expanded ? '' : 'truncate'}">
          {#if showRow}row {s.row}{s.column ? ` · ${s.column}` : ''} — {/if}{s.reason}
        </li>
      {/each}
    </ul>
    {#if issues.length > PREVIEW}
      <button onclick={() => (expanded = !expanded)}
        class="text-xs text-sky-700 hover:underline cursor-default" data-testid={`${testid}-toggle`}>
        {expanded ? 'Show fewer' : `Show all ${issues.length}`}
      </button>
    {/if}
    {#if expanded && total > issues.length}
      <p class="text-xs text-stone-400">Only the first {issues.length} of {total} are listed.</p>
    {/if}
  </div>
{/if}
