<svelte:options runes />

<script lang="ts">
  import { onMount } from 'svelte'
  import type { ManifestNode } from '../../../shared/types'
  import { suggestDuplicateNodeName, validateDuplicateNodeName } from '../../../shared/validation'
  import { collectSubtreeIds } from '../../../shared/subtree'

  interface Props {
    node: ManifestNode
    nodes: ManifestNode[]
    onConfirm: (name: string) => Promise<string | null>
    onCancel: () => void
  }
  let { node, nodes, onConfirm, onCancel }: Props = $props()
  let dialog: HTMLDialogElement
  let input: HTMLInputElement
  let name = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)
  const siblingNames = $derived(nodes.filter(candidate => candidate.parentId === node.parentId).map(candidate => candidate.name))
  const count = $derived(collectSubtreeIds(nodes, node.id).size)
  const validation = $derived(validateDuplicateNodeName(name.trim(), siblingNames))

  onMount(() => {
    name = suggestDuplicateNodeName(node.name, siblingNames)
    dialog.showModal()
    input.focus()
    input.select()
  })

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !validation.valid) return
    busy = true
    error = null
    try { error = await onConfirm(name.trim()) }
    catch { error = 'Could not duplicate this node. Try again.' }
    finally { busy = false }
  }
</script>

<dialog
  bind:this={dialog}
  oncancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}
  aria-labelledby="duplicate-title"
  aria-describedby="duplicate-description"
  class="m-auto w-full max-w-md rounded-xl border border-stone-200 bg-white p-0 text-stone-800 shadow-xl backdrop:bg-black/30"
  data-testid="duplicate-dialog"
>
  <form onsubmit={submit}>
    <div class="border-b border-stone-100 px-5 py-4">
      <h2 id="duplicate-title" class="text-sm font-semibold">Duplicate “{node.name}”</h2>
      <p id="duplicate-description" class="mt-1 text-xs text-stone-500">
        Create a copy beside the original{#if count > 1}, including {count - 1} {count === 2 ? 'descendant' : 'descendants'}{/if}.
        You can undo this as one operation.
      </p>
    </div>
    <div class="space-y-3 px-5 py-4">
      <label class="block text-xs font-medium">
        Copy name
        <input
          bind:this={input}
          bind:value={name}
          disabled={busy}
          aria-invalid={!validation.valid}
          aria-describedby={!validation.valid ? 'duplicate-validation' : undefined}
          class="selectable mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
          data-testid="duplicate-name-input"
        />
      </label>
      {#if !validation.valid}
        <p id="duplicate-validation" class="text-xs text-red-600" data-testid="duplicate-validation">{validation.message}</p>
      {/if}
      <p class="text-xs text-stone-500">All property values are copied, including serial numbers. Templates stay shared with the original.</p>
      <p class="text-xs text-stone-500">References within the copy point to copied nodes. References outside it keep their existing targets.</p>
      {#if error}<p role="alert" class="text-xs text-red-600" data-testid="duplicate-error">{error}</p>{/if}
    </div>
    <div class="flex justify-end gap-2 border-t border-stone-100 px-5 py-3">
      <button type="button" onclick={onCancel} disabled={busy} class="rounded-lg border border-stone-200 px-4 py-2 text-sm hover:bg-stone-50">Cancel</button>
      <button type="submit" disabled={busy || !validation.valid} class="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:bg-stone-300" data-testid="duplicate-confirm">
        {busy ? 'Duplicating…' : 'Duplicate'}
      </button>
    </div>
  </form>
</dialog>
