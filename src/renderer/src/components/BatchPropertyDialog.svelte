<svelte:options runes />

<script lang="ts">
  import { onMount } from 'svelte'
  import type { ManifestNode, Project } from '../../../shared/types'
  import {
    batchPropertyOptions,
    planBatchPropertyUpdate,
    type BatchPropertyUpdateRequest,
    type PropertyValue,
  } from '../../../shared/batch-properties'
  import { validatePropertyKey } from '../../../shared/validation'

  interface Props {
    project: Project
    nodes: ManifestNode[]
    onConfirm: (request: BatchPropertyUpdateRequest) => Promise<string | null>
    onCancel: () => void
  }

  let { project, nodes, onConfirm, onCancel }: Props = $props()
  let dialog: HTMLDialogElement
  let propertyChoice = $state('')
  let newKey = $state('')
  let draft = $state('')
  let touched = $state(false)
  let clear = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)

  const options = $derived(batchPropertyOptions(project, nodes))
  const key = $derived(propertyChoice === '__new__' ? newKey.trim() : propertyChoice)
  const selectedOption = $derived(options.find(option => option.key === key) ?? null)
  const field = $derived(selectedOption?.field ?? { type: 'string' as const })
  const keyValidation = $derived(validatePropertyKey(key))
  const currentValues = $derived(nodes.map(node => node.properties[key]))
  const currentSummary = $derived.by(() => {
    if (!key) return ''
    const distinct = new Set(currentValues.map(value => value === undefined ? '__missing__' : JSON.stringify(value)))
    return distinct.size > 1 ? 'Mixed values' : `Current: ${formatValue(currentValues[0])}`
  })
  const requestValue = $derived.by<PropertyValue | undefined>(() => {
    if (clear) return undefined
    if (field.type === 'boolean') return draft === 'true' ? true : draft === 'false' ? false : undefined
    return draft
  })
  const request = $derived<BatchPropertyUpdateRequest>({ nodeIds: nodes.map(node => node.id), key, clear, value: requestValue })
  const plan = $derived(keyValidation.valid && (clear || touched) && selectedOption?.compatible !== false
    ? planBatchPropertyUpdate(project, request)
    : null)

  onMount(() => { dialog.showModal() })

  function formatValue(value: PropertyValue | undefined): string {
    if (value === undefined) return 'not set'
    if (value === null) return 'null'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (field.type === 'reference') {
      const target = project.nodes.find(node => node.id === value)
      return target ? target.name : String(value)
    }
    return String(value)
  }

  function chooseProperty(value: string) {
    propertyChoice = value
    newKey = ''
    clear = false
    error = null
    const selectedKey = value === '__new__' ? '' : value
    const values = nodes.map(node => node.properties[selectedKey])
    const distinct = new Set(values.map(item => item === undefined ? '__missing__' : JSON.stringify(item)))
    if (selectedKey && distinct.size === 1 && values[0] !== undefined) {
      draft = String(values[0])
      touched = true
    } else {
      draft = ''
      touched = false
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !plan?.valid || plan.changes.length === 0) return
    busy = true
    error = null
    try { error = await onConfirm(request) }
    catch { error = 'Could not update the selected nodes. Try again.' }
    finally { busy = false }
  }
</script>

<dialog
  bind:this={dialog}
  oncancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}
  aria-labelledby="batch-title"
  class="m-auto w-full max-w-xl rounded-xl border border-stone-200 bg-white p-0 text-stone-800 shadow-xl backdrop:bg-black/30"
  data-testid="batch-property-dialog"
>
  <form onsubmit={submit}>
    <div class="border-b border-stone-100 px-5 py-4">
      <h2 id="batch-title" class="text-sm font-semibold">Edit properties on {nodes.length} nodes</h2>
      <p class="mt-1 text-xs text-stone-500">Choose one property and review the exact changes before applying them.</p>
    </div>
    <div class="space-y-4 px-5 py-4">
      <label class="block text-xs font-medium">
        Property
        <select
          value={propertyChoice}
          onchange={(event) => chooseProperty(event.currentTarget.value)}
          disabled={busy}
          class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          data-testid="batch-property-key"
        >
          <option value="">Choose a property…</option>
          {#each options as option (option.key)}
            <option value={option.key} disabled={!option.compatible}>{option.key}{option.compatible ? '' : ' — incompatible types'}</option>
          {/each}
          <option value="__new__">Add a new freeform property…</option>
        </select>
      </label>

      {#if propertyChoice === '__new__'}
        <label class="block text-xs font-medium">
          New property name
          <input bind:value={newKey} disabled={busy} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" data-testid="batch-new-key" />
        </label>
      {/if}

      {#if key}
        <div class="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600" data-testid="batch-current-value">{currentSummary}</div>
        <div class="flex gap-4 text-sm">
          <label class="flex items-center gap-2"><input type="radio" name="batch-action" checked={!clear} onchange={() => { clear = false }} /> Set value</label>
          <label class="flex items-center gap-2"><input type="radio" name="batch-action" checked={clear} onchange={() => { clear = true }} /> Clear property</label>
        </div>
        {#if !clear}
          <label class="block text-xs font-medium">
            New value
            {#if field.type === 'boolean'}
              <select bind:value={draft} onchange={() => { touched = true }} class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" data-testid="batch-property-value">
                <option value="">Choose true or false…</option><option value="true">true</option><option value="false">false</option>
              </select>
            {:else if field.type === 'enum'}
              <select bind:value={draft} onchange={() => { touched = true }} class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" data-testid="batch-property-value">
                <option value="">Choose a value…</option>{#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}
              </select>
            {:else if field.type === 'reference'}
              <select bind:value={draft} onchange={() => { touched = true }} class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" data-testid="batch-property-value">
                <option value="">Choose a node…</option>
                {#each project.nodes.filter(node => !nodes.some(selected => selected.id === node.id)) as target (target.id)}
                  <option value={target.id}>{target.name}</option>
                {/each}
              </select>
            {:else}
              <input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                bind:value={draft}
                oninput={() => { touched = true }}
                disabled={busy}
                placeholder={currentSummary === 'Mixed values' ? 'Mixed — enter a replacement' : ''}
                class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                data-testid="batch-property-value"
              />
            {/if}
          </label>
        {/if}
      {/if}

      {#if !keyValidation.valid && key}<p class="text-xs text-red-600">{keyValidation.message}</p>{/if}
      {#if selectedOption && !selectedOption.compatible}<p class="text-xs text-red-600">{selectedOption.message}</p>{/if}
      {#if plan && !plan.valid}<p class="text-xs text-red-600" data-testid="batch-validation">{plan.message}</p>{/if}
      {#if plan?.valid}
        <div class="rounded-lg border border-stone-200" data-testid="batch-preview">
          <div class="border-b border-stone-100 px-3 py-2 text-xs font-semibold">{plan.changes.length} of {nodes.length} nodes will change</div>
          <div class="max-h-48 overflow-auto p-2">
            {#each plan.changes as change (change.nodeId)}
              <div class="grid grid-cols-[1fr_auto_1fr] gap-2 px-1 py-1 text-xs">
                <span class="truncate font-medium" title={change.nodeName}>{change.nodeName}</span>
                <span class="text-stone-400">{formatValue(change.before)} →</span>
                <span class="truncate" title={formatValue(change.after)}>{formatValue(change.after)}</span>
              </div>
            {/each}
            {#if plan.changes.length === 0}<p class="px-1 py-2 text-xs text-stone-500">Every selected node already has this value.</p>{/if}
          </div>
        </div>
      {/if}
      {#if error}<p role="alert" class="text-xs text-red-600">{error}</p>{/if}
    </div>
    <div class="flex justify-end gap-2 border-t border-stone-100 px-5 py-3">
      <button type="button" onclick={onCancel} disabled={busy} class="rounded-lg border border-stone-200 px-4 py-2 text-sm hover:bg-stone-50">Cancel</button>
      <button type="submit" disabled={busy || !plan?.valid || plan.changes.length === 0} class="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white disabled:bg-stone-300" data-testid="batch-apply">
        {busy ? 'Applying…' : `Apply to ${plan?.valid ? plan.changes.length : 0} nodes`}
      </button>
    </div>
  </form>
</dialog>
