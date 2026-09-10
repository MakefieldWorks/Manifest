<svelte:options runes />
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { ExternalDocumentPreview, Project } from '../../../shared/types'
  let { onStatus, onResolved }: { onStatus: (conflicted: boolean) => void; onResolved: (project: Project, loadedExternal: boolean) => Promise<void> } = $props()
  let message: string | null = $state(null)
  let preview: ExternalDocumentPreview | null = $state(null)
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
        const result = await window.api.documentConflict.status()
        if (!disposed && result.ok) { message = result.data.message; onStatus(message !== null) }
      } catch { /* Keep the previous save status until the connection returns. */ }
      finally { polling = false }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  })
  async function review() {
    error = null
    busy = true
    try {
      const result = await window.api.documentConflict.review()
      if (!result.ok) error = result.error.message
      else { preview = result.data; await tick(); dialog.showModal() }
    } catch (failure) { error = String(failure) }
    finally { busy = false }
  }
  async function retrySave() {
    if (busy) return
    busy = true
    try {
      const result = await window.api.project.save()
      if (result.ok) { message = null; error = null; onStatus(false) }
      else error = result.error.message
    } catch (failure) { error = String(failure) }
    finally { busy = false }
  }
  async function resolve(choice: 'keep-local' | 'load-external') {
    if (!preview || busy) return
    busy = true
    error = null
    try {
      const result = await window.api.documentConflict.resolve({ token: preview.token, choice })
      if (!result.ok) { error = result.error.message; dialog.close(); preview = null }
      else {
        dialog.close()
        preview = null
        message = null
        onStatus(false)
        await onResolved(result.data, choice === 'load-external')
      }
    } catch (failure) { error = String(failure) }
    finally { busy = false }
  }
</script>

{#if message}
  <div class="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-testid="external-document-conflict">
    <p class="break-words selectable">{message}</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <button disabled={busy} onclick={review} class="rounded border border-amber-300 bg-white px-3 py-1.5">Review both versions</button>
    <button disabled={busy} onclick={retrySave} class="ml-2 rounded border border-amber-300 bg-white px-3 py-1.5">Retry save</button>
  </div>
{/if}
{#if preview}
  <dialog bind:this={dialog} aria-label="Resolve external project change" oncancel={(event) => { event.preventDefault(); if (!busy) { dialog.close(); preview = null } }} class="max-h-[90vh] w-full max-w-lg space-y-4 overflow-auto rounded-xl bg-white p-6 text-sm text-stone-700 shadow-xl backdrop:bg-black/30" data-testid="external-document-review">
    <h2 class="text-lg font-semibold">Choose which inventory to continue with</h2>
    <p>Current inventory: {preview.localNodeCount} nodes. External inventory: {preview.externalNodeCount ?? 'unavailable'}.</p>
    <p>{preview.externalDescription}</p>
    <p>Both available versions will be preserved as additional recovery files before continuing. No automatic merge is performed.</p>
    <p>Keep current writes your inventory to the project file and keeps Undo/Redo. Load external keeps the external file, replaces the current inventory, clears Undo/Redo, and resets assumed snapshot lineage.</p>
    <div class="flex flex-wrap gap-2">
      <button disabled={busy} onclick={() => resolve('keep-local')} class="rounded bg-stone-800 px-3 py-2 text-white" data-testid="conflict-keep-local">Keep current</button>
      <button disabled={busy || !preview.canLoadExternal} onclick={() => resolve('load-external')} class="rounded border border-stone-300 px-3 py-2 disabled:opacity-40" data-testid="conflict-load-external">Load external</button>
      <button disabled={busy} onclick={() => { dialog.close(); preview = null }} class="rounded border border-stone-300 px-3 py-2">Cancel</button>
    </div>
  </dialog>
{/if}
