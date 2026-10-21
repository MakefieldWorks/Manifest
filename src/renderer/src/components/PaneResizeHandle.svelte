<svelte:options runes />

<script lang="ts">
  // A 1px column between panes that starts a resize drag. The parent tracks
  // the drag on window mousemove/mouseup so it keeps working when the
  // pointer leaves the handle.
  interface Props {
    label: string
    active: boolean
    onStart: (e: MouseEvent) => void
  }

  let { label, active, onStart }: Props = $props()
</script>

<button
  type="button"
  aria-label={label}
  class="w-1 shrink-0 cursor-col-resize bg-stone-200 hover:bg-sky-400
         transition-colors duration-100 p-0"
  class:bg-sky-500={active}
  onmousedown={onStart}
></button>
