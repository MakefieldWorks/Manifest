<svelte:options runes />

<script lang="ts">
  import type { HistoryBackupStatus } from '../../../shared/types'
  let { onRestored }: { onRestored: (path: string | null) => Promise<void> } = $props()
  let status: HistoryBackupStatus | null = $state(null)
  let busy = $state(false)
  let error: string | null = $state(null)

  async function review() {
    busy = true
    error = null
    const result = await window.api.snapshot.historyBackupStatus()
    busy = false
    if (result.ok) status = result.data
    else error = result.error.message
  }

  async function restore() {
    if (!status?.available || busy) return
    busy = true
    const result = await window.api.snapshot.restoreHistoryBackup({ token: status.token })
    busy = false
    if (result.ok) await onRestored(result.data.preservedPath)
    else {
      error = result.error.message
      status = null
    }
  }
</script>

<div class="mt-3 rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700" data-testid="history-backup-repair">
  {#if error}<p role="alert" class="mb-2 text-red-700">{error}</p>{/if}
  {#if status?.available}
    <h4 class="font-semibold">Restore history from backup</h4>
    <p class="mt-1">Saved {new Date(status.savedAt).toLocaleString()}</p>
    <p class="mt-1">{status.snapshotCount} snapshots · {status.eventCount} timeline events · {status.recoveryPointCount} recovery points</p>
    <p class="mt-2">This restores history metadata only. Your current inventory and Undo/Redo remain unchanged.{#if !status.originalMissing} The damaged file is kept separately.{/if}</p>
    <p class="mt-2">Context recorded after this backup may be absent. The next snapshot will start without an assumed baseline or revert lineage.</p>
    {#if status.originalMissing}<p class="mt-2">The original history file is missing; there is no damaged file to preserve.</p>{/if}
    {#if status.missingSnapshots.length}
      <p class="mt-2">Snapshots reconstructed from Git: {status.missingSnapshots.join(', ')}. Missing descriptions cannot be recovered; timeline placement uses approximate Git timestamps.</p>
    {/if}
    {#if status.unlistedRecoveryFiles.length}
      <p class="mt-2">{status.unlistedRecoveryFiles.length} additional recovery files are not listed in this backup. They will be kept on disk but will not be added to the timeline.</p>
    {/if}
    <div class="mt-3 flex gap-2">
      <button disabled={busy} onclick={() => { status = null }} class="rounded border border-stone-200 px-2 py-1">Cancel</button>
      <button disabled={busy} onclick={restore} class="rounded bg-stone-800 px-2 py-1 text-white disabled:opacity-50" data-testid="history-backup-confirm">
        {busy ? 'Restoring…' : 'Restore this backup'}
      </button>
    </div>
  {:else}
    {#if status && !status.available}<p class="mb-2" role="status">{status.reason}</p>{/if}
    <button disabled={busy} onclick={review} class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50" data-testid="history-backup-review">
      {busy ? 'Checking backup…' : 'Review automatic backup'}
    </button>
  {/if}
</div>
