<svelte:options runes />

<script lang="ts">
  import type { RecoveryFilePreview, RecoveryPoint } from '../../../shared/types'
  let { points, onRefresh, onRecover, disabled = false }: {
    points: RecoveryPoint[]; onRefresh: () => Promise<void>; onRecover: (id: string) => void; disabled?: boolean
  } = $props()
  let preview: RecoveryFilePreview | null = $state(null)
  let selected: string | null = $state(null)
  let busy = $state(false)
  let error: string | null = $state(null)
  let message: string | null = $state(null)
  let removing: string | null = $state(null)
  async function review() {
    busy = true
    error = null
    message = null
    selected = null
    try {
      const result = await window.api.snapshot.recoveryFilesPreview()
      if (result.ok) preview = result.data
      else { error = result.error.message; preview = null }
    } catch (failure) { error = String(failure); preview = null }
    finally { busy = false }
  }
  async function adopt() {
    if (!preview || !selected || busy || disabled) return
    busy = true
    try {
      const result = await window.api.snapshot.adoptRecoveryFile({ token: preview.token, name: selected })
      preview = null
      selected = null
      if (result.ok) {
        await onRefresh()
        message = 'Recovery point added. Your current inventory and Undo/Redo are unchanged.'
      } else error = result.error.message
    } catch (failure) { error = String(failure); preview = null; selected = null }
    finally { busy = false }
  }
  async function forget(id: string) {
    if (busy || disabled) return
    busy = true
    error = null
    try {
      const result = await window.api.snapshot.forgetRecoveryFile({ id })
      if (result.ok) {
        preview = null
        selected = null
        await onRefresh()
        message = 'Removed from the list. Any file on disk has been kept.'
      } else error = result.error.message
    } catch (failure) { error = String(failure) }
    finally { busy = false; removing = null }
  }
</script>

<section class="space-y-2 border-t border-stone-200 px-4 py-3 text-xs text-stone-600" data-testid="recovery-files">
  <h3 class="font-semibold text-stone-700">Additional recovery files</h3>
  <p>Review saved files that are missing from the history records.</p>
  {#if error}<p role="alert" class="text-red-700">{error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
  <button disabled={busy || disabled} onclick={review} class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50" data-testid="recovery-files-review">{busy ? 'Checking…' : 'Review recovery files'}</button>
  {#if preview}
    {#if preview.uninspectedCount}<p>{preview.uninspectedCount} more files were not inspected. Each review lists at most 100 unlisted files; add eligible files or move other files to a safe external folder, then review again.</p>{/if}
    {#if !preview.files.length}<p>No unlisted recovery files found.</p>{/if}
    {#each preview.files as file (file.name)}
      <div class="space-y-1 rounded border border-stone-200 p-2" data-testid="recovery-file-row">
        <p class="break-all font-medium">{file.name}</p>
        {#if file.eligible}<p>{file.projectName} · {file.nodeCount} inventory nodes</p>{/if}
        <p>{file.explanation}</p>
        {#if file.eligible}
          <button disabled={busy || disabled} onclick={() => { selected = file.name }} class="rounded border border-stone-300 px-2 py-1">Review adding this file</button>
        {/if}
      </div>
    {/each}
    {#if selected}
      <div class="space-y-2 rounded border border-amber-200 bg-amber-50 p-2" data-testid="recovery-file-confirmation">
        <p class="break-all font-medium">Add {selected}?</p>
        <p>This adds a recovery point only. Current inventory and Undo/Redo stay unchanged. The original save time and operation context are unknown; the date shown will be when you added it.</p>
        <p>Added files are kept beyond the automatic ten-point retention limit. No files will be deleted.</p>
        <button disabled={busy || disabled} onclick={adopt} class="rounded bg-stone-800 px-2 py-1 text-white" data-testid="recovery-file-add">Add recovery point</button>
      </div>
    {/if}
    <button disabled={busy} onclick={() => { preview = null; selected = null }} class="rounded border border-stone-300 px-2 py-1">Cancel</button>
  {/if}
  {#each points.filter(point => point.reason === 'reconciled') as point (point.id)}
    <div class="space-y-1 rounded border border-stone-200 p-2" data-testid="reconciled-recovery-point">
      <p class="break-all font-medium">{point.id}</p>
      <p>Added {new Date(point.createdAt).toLocaleString()} · original save time unknown</p>
      <button disabled={busy || disabled} onclick={() => onRecover(point.id)} class="rounded border border-stone-300 px-2 py-1">Recover</button>
      <button disabled={busy || disabled} onclick={() => { removing = point.id }} class="rounded border border-stone-300 px-2 py-1">Remove from list</button>
      {#if removing === point.id}
        <p>Remove this recovery point from the list? Its file will stay on disk and may appear in a later review. Past recovery events remain recorded.</p>
        <button disabled={busy || disabled} onclick={() => forget(point.id)} class="rounded bg-stone-800 px-2 py-1 text-white" data-testid="recovery-file-forget">Confirm removal</button>
        <button disabled={busy} onclick={() => { removing = null }} class="rounded border border-stone-300 px-2 py-1">Cancel removal</button>
      {/if}
    </div>
  {/each}
</section>
