<svelte:options runes />

<script lang="ts">
  import type { NodeTemplate } from '../../../shared/types'
  import { templateLabel } from '../../../shared/validation'

  // Inline "add child" form shown below the tree. The parent owns the draft
  // and commits it over IPC; name, template, and the input element are bound
  // so the parent can reset the draft and focus the input when it opens.
  interface Props {
    name: string
    templateId: string | null
    inputEl: HTMLInputElement | null
    error: string | null
    /** Usable template ids, sorted. */
    templateIds: string[]
    templates: Record<string, NodeTemplate>
    onCommit: () => void
    onCancel: () => void
  }

  let {
    name = $bindable(), templateId = $bindable(), inputEl = $bindable(),
    error, templateIds, templates, onCommit, onCancel,
  }: Props = $props()
</script>

<div class="border-t border-stone-200 px-3 py-2 flex flex-col gap-1 bg-stone-50 shrink-0">
  <input
    type="text"
    bind:this={inputEl}
    bind:value={name}
    placeholder="Node name"
    class="w-full text-sm border border-stone-300 rounded px-2 py-1
           focus:outline-none focus:ring-1 focus:ring-stone-400 selectable"
    data-testid="add-child-input"
    onkeydown={(e) => {
      if (e.key === 'Enter') onCommit()
      if (e.key === 'Escape') onCancel()
    }}
  />
  {#if error}
    <p class="text-xs text-red-600">{error}</p>
  {/if}
  {#if templateIds.length > 0}
    <select
      bind:value={templateId}
      class="w-full text-sm border border-stone-300 rounded px-2 py-1 bg-white
             focus:outline-none focus:ring-1 focus:ring-stone-400"
      data-testid="add-child-template"
    >
      <option value={null}>Freeform (no template)</option>
      {#each templateIds as id (id)}
        <option value={id}>{templateLabel(templates[id], id)}</option>
      {/each}
    </select>
  {/if}
  <div class="flex gap-1">
    <button
      onclick={onCommit}
      class="text-xs bg-stone-800 text-white px-2 py-1 rounded cursor-default"
      data-testid="add-child-commit"
    >Add</button>
    <button
      onclick={onCancel}
      class="text-xs text-stone-500 px-2 py-1 rounded hover:bg-stone-100 cursor-default"
    >Cancel</button>
  </div>
</div>
