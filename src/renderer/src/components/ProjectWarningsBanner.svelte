<svelte:options runes />

<script lang="ts">
  import type { ProjectWarning } from '../../../shared/types'

  interface Props {
    /** The first project warning; the banner shows one at a time. */
    warning: ProjectWarning
    onDismiss: () => void
  }

  let { warning, onDismiss }: Props = $props()
</script>

<!-- Project-level warning (non-blocking; environmental risk) -->
<div
  class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
  data-testid="project-warnings-banner"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="font-semibold">
        {warning.title}
        <span class="font-normal text-amber-700">— local indexes may corrupt under partial sync.</span>
      </p>
      <p class="mt-1 text-amber-800">
        {warning.message}
      </p>
    </div>
    <button
      onclick={onDismiss}
      class="shrink-0 text-amber-700 hover:text-amber-900 cursor-default"
      aria-label="Dismiss project warning"
      data-testid="dismiss-project-warning"
    >✕</button>
  </div>
</div>
