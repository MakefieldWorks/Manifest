<svelte:options runes />

<script lang="ts">
  import type { InterruptedHistoryEvidencePreview } from '../../../shared/types'

  let { disabled = false }: { disabled?: boolean } = $props()
  let preview: InterruptedHistoryEvidencePreview | null = $state(null)
  let selected: string | null = $state(null)
  let activity: 'review' | 'delete' | null = $state(null)
  let busy = $derived(activity !== null)
  let error: string | null = $state(null)
  let message: string | null = $state(null)

  const kindLabels = {
    'snapshot-create': 'Snapshot creation',
    'snapshot-revert': 'Snapshot revert',
    'recovery-apply': 'Recovery application',
    'recovery-register': 'Recovery registration',
    'recovery-forget': 'Recovery registration removal',
    'history-backup-restore': 'History backup restoration',
  } as const

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function review() {
    if (busy || disabled) return
    activity = 'review'
    error = null
    message = null
    selected = null
    try {
      const result = await window.api.historyOperation.evidencePreview()
      if (result.ok) preview = result.data
      else { error = result.error.message; preview = null }
    } catch (failure) { error = String(failure); preview = null }
    finally { activity = null }
  }

  async function remove(id: string, token: string) {
    if (busy || disabled) return
    activity = 'delete'
    error = null
    message = null
    try {
      const result = await window.api.historyOperation.deleteEvidence({ id, token })
      selected = null
      if (!result.ok) {
        preview = null
        error = result.error.message
      } else {
        if (result.data.remainingFiles.length) {
          error = `The evidence record was removed, but these files could not be deleted and were kept in the project's recovery folder for manual handling: ${result.data.remainingFiles.join(', ')}`
        } else {
          message = `Permanently deleted ${result.data.deletedFiles.length} evidence files.`
        }
        try {
          const refreshed = await window.api.historyOperation.evidencePreview()
          preview = refreshed.ok ? refreshed.data : null
          if (!refreshed.ok) error = `${error ? `${error} ` : ''}Could not refresh retained evidence: ${refreshed.error.message}`
        } catch (failure) {
          preview = null
          error = `${error ? `${error} ` : ''}Could not refresh retained evidence: ${String(failure)}`
        }
      }
    } catch (failure) { preview = null; selected = null; error = String(failure) }
    finally { activity = null }
  }
</script>

<section class="space-y-2 border-t border-stone-200 px-4 py-3 text-xs text-stone-600" data-testid="interrupted-evidence-cleanup">
  <h3 class="font-semibold text-stone-700">Interrupted operation evidence</h3>
  <p>Review retained before-state copies. Keep them for recovery, or include them in a portable archive before permanently deleting them.</p>
  {#if error}<p role="alert" class="break-words text-red-700">{error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
  <button disabled={busy || disabled} onclick={review} class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50" data-testid="interrupted-evidence-review">
    {activity === 'review' ? 'Checking…' : activity === 'delete' ? 'Deleting…' : 'Review retained evidence'}
  </button>
  {#if preview}
    {#if !preview.historyReadable}<p>History metadata is missing or unreadable. Retained evidence is available for review, but restore history before deleting it.</p>{/if}
    {#if preview.unavailableCount}<p>{preview.unavailableCount} evidence group{preview.unavailableCount === 1 ? '' : 's'} could not be verified and will be left untouched.</p>{/if}
    {#if preview.uninspectedCount}<p>{preview.uninspectedCount} more evidence group{preview.uninspectedCount === 1 ? '' : 's'} were not inspected. Each review lists at most 100.</p>{/if}
    {#if !preview.groups.length}<p>No verified retained evidence found.</p>{/if}
    {#each preview.groups as group (group.id)}
      <div class="space-y-1 rounded border border-stone-200 p-2" data-testid="interrupted-evidence-row">
        <p class="font-medium text-stone-700">{group.label}</p>
        <p>{group.kind ? kindLabels[group.kind] : 'Legacy operation'}{group.targetId ? ` · ${group.targetId}` : ''}</p>
        <p>Started {new Date(group.startedAt).toLocaleString()} · {group.beforeNodeCount} nodes before · {group.currentNodeCount} now · {formatBytes(group.sizeBytes)}</p>
        <details>
          <summary class="cursor-default">{group.files.length} retained files</summary>
          <ul class="mt-1 list-disc space-y-0.5 pl-5">
            {#each group.files as file}<li class="break-all">{file}</li>{/each}
          </ul>
        </details>
        {#if group.registeredAsRecoveryPoint}
          <p>This before-state inventory is listed under Additional recovery files. Remove it from that list before deleting this evidence.</p>
        {:else if preview.historyReadable}
          <button disabled={busy || disabled} onclick={() => { selected = group.id }} class="rounded border border-red-300 px-2 py-1 text-red-700">Review permanent deletion</button>
        {/if}
        {#if selected === group.id}
          <div class="mt-2 space-y-2 rounded border border-red-200 bg-red-50 p-2" data-testid="interrupted-evidence-confirmation">
            <p class="font-medium text-red-800">Permanently delete these {group.files.length} files?</p>
            <p>This removes the retained inventory and history for this operation. It cannot be undone.</p>
            <div class="flex flex-wrap gap-2">
              <button disabled={busy || disabled} onclick={() => remove(group.id, group.token)} class="rounded bg-red-700 px-2 py-1 text-white" data-testid="interrupted-evidence-delete">Delete evidence permanently</button>
              <button disabled={busy} onclick={() => { selected = null }} class="rounded border border-stone-300 px-2 py-1">Cancel</button>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <button disabled={busy} onclick={() => { preview = null; selected = null }} class="rounded border border-stone-300 px-2 py-1">Close review</button>
  {/if}
</section>
