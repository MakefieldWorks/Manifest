<svelte:options runes />

<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { LaunchBehavior } from '../../shared/ipc'

  let launchBehavior: LaunchBehavior = $state('project-hub')
  let loading = $state(true)
  let saving = $state(false)
  let resetting = $state(false)
  let status: string | null = $state(null)
  let error: string | null = $state(null)
  let unsubscribeWindowFocus: (() => void) | null = null

  function applyWindowFocus(isFocused: boolean) {
    document.documentElement.dataset.windowFocused = String(isFocused)
  }

  onMount(async () => {
    unsubscribeWindowFocus = window.api.windowState.onFocusChanged(applyWindowFocus)
    const focusState = await window.api.windowState.isFocused()
    if (focusState.ok) applyWindowFocus(focusState.data)

    const preferences = await window.api.settings.getPreferences()
    if (preferences.ok) {
      launchBehavior = preferences.data.launchBehavior
    } else {
      error = `Could not load settings: ${preferences.error.message}`
    }
    loading = false
  })

  onDestroy(() => {
    unsubscribeWindowFocus?.()
    delete document.documentElement.dataset.windowFocused
  })

  async function saveLaunchBehavior(next: LaunchBehavior) {
    launchBehavior = next
    saving = true
    error = null
    status = null
    const result = await window.api.settings.updatePreferences({ launchBehavior: next })
    saving = false
    if (!result.ok) {
      error = `Could not save settings: ${result.error.message}`
      return
    }
    status = 'Saved. This will take effect the next time Manifest starts.'
  }

  async function resetLayout() {
    resetting = true
    error = null
    status = null
    const result = await window.api.settings.resetLayout()
    resetting = false
    if (!result.ok) {
      error = `Could not reset layout: ${result.error.message}`
      return
    }
    status = 'Window size and pane layout reset.'
  }
</script>

<svelte:head>
  <title>Manifest Settings</title>
</svelte:head>

<main class="min-h-full bg-stone-50 px-8 py-8 text-stone-800">
  <header class="flex items-center gap-3 border-b border-stone-200 pb-6">
    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-stone-200">
      <img src="./manifest-mark.svg" alt="" class="h-6 w-6" />
    </div>
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Settings</h1>
      <p class="mt-0.5 text-sm text-stone-500">Manifest application preferences</p>
    </div>
  </header>

  {#if error}
    <div class="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
      {error}
    </div>
  {/if}

  <section class="mt-7" aria-labelledby="startup-heading">
    <h2 id="startup-heading" class="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">On launch</h2>
    <p class="mt-2 text-sm leading-5 text-stone-600">Choose what appears when Manifest starts without a project opened from Finder or Explorer.</p>

    <div class="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
      <label class="flex cursor-default items-start gap-3 px-4 py-3 hover:bg-stone-50">
        <input
          type="radio"
          name="launch-behavior"
          value="project-hub"
          checked={launchBehavior === 'project-hub'}
          onchange={() => void saveLaunchBehavior('project-hub')}
          disabled={loading || saving}
          class="mt-0.5 h-4 w-4 accent-stone-800"
          data-testid="launch-project-hub"
        />
        <span>
          <span class="block text-sm font-medium text-stone-800">Open Project Hub</span>
          <span class="mt-0.5 block text-xs leading-5 text-stone-500">Show recent projects and options to open or create a project.</span>
        </span>
      </label>
      <label class="flex cursor-default items-start gap-3 border-t border-stone-100 px-4 py-3 hover:bg-stone-50">
        <input
          type="radio"
          name="launch-behavior"
          value="reopen-last-project"
          checked={launchBehavior === 'reopen-last-project'}
          onchange={() => void saveLaunchBehavior('reopen-last-project')}
          disabled={loading || saving}
          class="mt-0.5 h-4 w-4 accent-stone-800"
          data-testid="launch-reopen-last-project"
        />
        <span>
          <span class="block text-sm font-medium text-stone-800">Reopen last project</span>
          <span class="mt-0.5 block text-xs leading-5 text-stone-500">Open the most recently used project when it is still available.</span>
        </span>
      </label>
    </div>
  </section>

  <section class="mt-8 border-t border-stone-200 pt-7" aria-labelledby="layout-heading">
    <h2 id="layout-heading" class="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Workspace layout</h2>
    <div class="mt-3 flex items-center justify-between gap-6 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div>
        <p class="text-sm font-medium text-stone-800">Reset window and panes</p>
        <p class="mt-0.5 text-xs leading-5 text-stone-500">Restore the default window size and sidebar widths. Your projects and recent-project list are kept.</p>
      </div>
      <button
        type="button"
        onclick={() => void resetLayout()}
        disabled={resetting}
        class="shrink-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        data-testid="reset-layout"
      >
        {resetting ? 'Resetting…' : 'Reset Layout'}
      </button>
    </div>
  </section>

  {#if status}
    <p class="mt-5 text-sm text-emerald-700" role="status">{status}</p>
  {/if}
</main>
