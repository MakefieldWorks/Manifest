<svelte:options runes />

<script lang="ts">
  import type { ManifestWarning } from '../../../shared/types'

  interface Props {
    warnings: ManifestWarning[]
    onDismiss: () => void
  }

  let { warnings: loadWarnings, onDismiss }: Props = $props()
</script>

<!-- Load-time warnings (non-blocking; values left as-on-disk) -->
<div
  class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
  data-testid="load-warnings-banner"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="font-semibold">
        {loadWarnings.length} data issue{loadWarnings.length === 1 ? '' : 's'} found on open
        <span class="font-normal text-amber-700">— values were left exactly as written on disk.</span>
      </p>
      <ul class="mt-1 space-y-0.5">
        {#each loadWarnings.slice(0, 5) as w (w.path)}
          <li class="truncate">
            <span class="font-mono text-amber-700">{w.path}</span>
            <span class="text-amber-800"> — {w.message}</span>
          </li>
        {/each}
        {#if loadWarnings.length > 5}
          <li class="text-amber-700">…and {loadWarnings.length - 5} more</li>
        {/if}
      </ul>
    </div>
    <button
      onclick={onDismiss}
      class="shrink-0 text-amber-700 hover:text-amber-900 cursor-default"
      aria-label="Dismiss warnings"
      data-testid="dismiss-load-warnings"
    >✕</button>
  </div>
</div>
