<svelte:options runes />
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { InterruptedHistoryPreview, Project } from '../../../shared/types'
  let { onStatus, onResolved }: { onStatus: (pending: boolean) => void; onResolved: (project: Project) => Promise<void> } = $props()
  let pending = $state(false)
  let preview: InterruptedHistoryPreview | null = $state(null)
  let error: string | null = $state(null)
  let busy = $state(false)
  let dialog: HTMLDialogElement = $state(null!)
  onMount(() => {
    let disposed = false
    let polling = false
    async function poll() {
      if (polling) return
      polling = true
      try {
        const result = await window.api.historyOperation.status()
        if (!disposed && result.ok) { pending = result.data.pending; onStatus(pending) }
      } catch { /* Retain the prior status until IPC returns. */ }
      finally { polling = false }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  })
  async function review() {
    busy = true
    error = null
    try {
      const result = await window.api.historyOperation.review()
      if (!result.ok) error = result.error.message
      else { preview = result.data; await tick(); dialog.showModal() }
    } catch (failure) { error = String(failure) }
    finally { busy = false }
  }
  async function acknowledge() {
    if (!preview || busy) return
    busy = true
    error = null
    try {
      const result = await window.api.historyOperation.acknowledge({ token: preview.token })
      dialog.close()
      preview = null
      if (!result.ok) error = result.error.message
      else { pending = false; onStatus(false); await onResolved(result.data) }
    } catch (failure) { error = String(failure) }
    finally { busy = false }
  }
</script>

{#if pending}
  <div class="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-testid="interrupted-history">
    <p>A history operation did not finish cleanly. Saving and editing are paused while you review the preserved inventory.</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <button disabled={busy} onclick={review} class="rounded border border-amber-300 bg-white px-3 py-1.5">Review unfinished operation</button>
  </div>
{/if}
{#if preview}
  <dialog bind:this={dialog} aria-label="Review unfinished history operation" oncancel={(event) => { event.preventDefault(); if (!busy) { dialog.close(); preview = null } }} class="max-h-[90vh] w-full max-w-lg space-y-4 overflow-auto rounded-xl bg-white p-6 text-sm text-stone-700 shadow-xl backdrop:bg-black/30" data-testid="interrupted-history-review">
    <h2 class="text-lg font-semibold">Review unfinished history operation</h2>
    <p>{preview.label}</p>
    <p>Started {new Date(preview.startedAt).toLocaleString()}. Before: {preview.beforeNodeCount} nodes. Current inventory: {preview.currentNodeCount} nodes.</p>
    <p>The operation may have changed the inventory or created a snapshot before stopping. Existing snapshots and history entries will remain; no operation will be replayed.</p>
    <p>Continue saves the current inventory, clears Undo/Redo, and resets its snapshot association. Both the earlier inventory and current inventory are preserved. To restore the earlier inventory afterward, use Additional recovery files in the Snapshots panel.</p>
    <p class="break-words selectable">Earlier inventory: {preview.recoveryPath}</p>
    <div class="flex flex-wrap gap-2">
      <button disabled={busy} onclick={acknowledge} class="rounded bg-stone-800 px-3 py-2 text-white">Continue with current inventory</button>
      <button disabled={busy} onclick={() => { dialog.close(); preview = null }} class="rounded border border-stone-300 px-3 py-2">Cancel</button>
    </div>
  </dialog>
{/if}
