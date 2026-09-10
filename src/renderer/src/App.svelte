<svelte:options runes />

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import ProjectArchive from './components/ProjectArchive.svelte'
  import ExternalDocumentConflict from './components/ExternalDocumentConflict.svelte'
  let externalDocumentConflict = $state(false)
  let archiveOpen = $state(false)
  import type { EditHistoryState, Project, ManifestNode, ManifestWarning, ProjectWarning, NodeTemplate, PropertyType, RecoveryPoint, ReferenceBlocker, SearchResult, Snapshot, SnapshotTimelineEvent, ImportResult } from '../../shared/types'
  import { isUsableTemplate, templateLabel } from '../../shared/validation'
  import { CURRENT_PROJECT_REF, snapshotRefLabel } from '../../shared/snapshot-ref'
  import {
    createDisabledMenuCommandState,
    type MenuCommandId,
    type MenuCommandState,
  } from '../../shared/menu-commands'
  import type { MergedTree } from '../../shared/merged-tree'
  import { computeSubtreeSummaries, templatesForNode } from '../../shared/merged-tree'
  import type { RecentProject, WorkspaceSettings } from '../../shared/ipc'
  import type { BatchPropertyUpdateRequest } from '../../shared/batch-properties'
  import type { ReportFormat } from '../../shared/report'
  import { hasInventoryFilters, hasPropertyPredicate, type InventoryFilters } from '../../shared/inventory-filters'
  import { DEFAULT_INVENTORY_COLUMNS, type InventoryColumn, type InventorySortDirection } from '../../shared/inventory-table'
  import { buildTree, getSiblingIndex, getAncestorIds } from './lib/tree'
  import { flattenTree } from './lib/tree-rows'
  import { isTextEditing } from './lib/edit-focus'
  import { cycleIndex } from './lib/tree-typeahead'
  import ManifestView from './components/ManifestView.svelte'
  import DetailPane from './components/DetailPane.svelte'
  import MoveToDialog from './components/MoveToDialog.svelte'
  import DuplicateDialog from './components/DuplicateDialog.svelte'
  import BatchSelectionPane from './components/BatchSelectionPane.svelte'
  import BatchPropertyDialog from './components/BatchPropertyDialog.svelte'
  import InventoryFilterPanel from './components/InventoryFilterPanel.svelte'
  import InventoryTable from './components/InventoryTable.svelte'
  import TemplateManager from './components/TemplateManager.svelte'
  import ImportDialog from './components/ImportDialog.svelte'
  import RecoveryDialog from './components/RecoveryDialog.svelte'
  import RevertDialog from './components/RevertDialog.svelte'
  import SnapshotsPanel from './components/SnapshotsPanel.svelte'

  let editHistory: EditHistoryState = $state({ undoLabel: null, redoLabel: null })
  let undoRedoBusy = $state(false)
  let textEditing = $state(false)
  let duplicateNodeId = $state<string | null>(null)
  const duplicateNode = $derived.by(() => project?.nodes.find(node => node.id === duplicateNodeId))

  function updateEditFocus(event: FocusEvent) {
    const sync = () => { textEditing = isTextEditing(document.activeElement) }
    // A removed dialog input can still be document.activeElement while its
    // focusout event is dispatching. Re-read after focus settles so native
    // edit commands do not remain disabled after the dialog closes.
    if (event.type === 'focusout') queueMicrotask(sync)
    else sync()
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || isTextEditing(document.activeElement)) return
    const modifier = desktopChrome.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (!modifier) return
    const key = event.key.toLowerCase()
    if (key === 'd' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      void runMenuCommand('node:duplicate')
      return
    }
    const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') :
      key === 'y' && event.ctrlKey ? 'redo' : null
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    void applyUndoRedo(direction)
  }

  // Cancel stale replies when another edit, close, or project switch wins the race.
  $effect(() => {
    const current = project
    let cancelled = false
    editHistory = { undoLabel: null, redoLabel: null }
    if (current) {
      void window.api.project.editHistory().then(result => {
        if (!cancelled && result.ok) editHistory = result.data
      })
    }
    return () => { cancelled = true }
  })

  const canUndoProject = $derived.by(() => appState === 'open' && project !== null && !editingLocked &&
    !archiveOpen && !snapshotCreating && !snapshotComparing && !importDialogOpen && !templateManagerOpen &&
    !duplicateNodeId && !batchDialogOpen && !moveToNodeId && !addingChildTo && !revertDialogSnapshotName && !recoveryDialogPoint)

  async function applyUndoRedo(direction: 'undo' | 'redo') {
    if (!canUndoProject || !editHistory[direction === 'undo' ? 'undoLabel' : 'redoLabel']) return
    const label = editHistory[direction === 'undo' ? 'undoLabel' : 'redoLabel']
    undoRedoBusy = true
    try {
      const result = await window.api.project[direction]()
      if (!result.ok) { showToast(result.error.message); return }
      applyProject(result.data)
      markWorkingCopyChanged()
      if (workingCopyBaseSnapshot) {
        const comparison = await window.api.snapshot.loadCompare(workingCopyBaseSnapshot, CURRENT_PROJECT_REF)
        if (comparison.ok) workingCopyDirty = comparison.data.nodes.some(node => node.status !== 'unchanged') ||
          (comparison.data.templateChanges?.length ?? 0) > 0
      }
      showToast(`${direction === 'undo' ? 'Undid' : 'Redid'} ${label?.toLowerCase()}`)
    } finally { undoRedoBusy = false }
  }

  type AppState = 'welcome' | 'creating' | 'loading' | 'open'

  // ─── State ────────────────────────────────────────────────────────────────

  let appState: AppState       = $state('welcome')
  let project:  Project | null = $state(null)
  let error:    string | null  = $state(null)
  let newName:  string         = $state('')
  let newPath:  string         = $state('')
  let creating: boolean        = $state(false)

  // Tree UI state
  let selectedId:  string | null = $state(null)
  let selectedIds: Set<string> = $state(new Set())
  let selectionRecency: string[] = $state([])
  let selectionAnchorId: string | null = $state(null)
  // When the user has a ghost selected in compare mode and leaves compare mode
  // (closing the snapshot pair), the ghost id can't survive in `selectedId`
  // because nothing in the live project resolves it. We stash it here so the
  // next time the same snapshot pair is compared, the selection is restored.
  // Cleared whenever the user makes a fresh live selection (issue #3).
  let stashedGhostSelection: string | null = $state(null)
  let expandedIds: Set<string>   = $state(new Set())
  let searchQuery: string        = $state('')
  let searchResults: SearchResult[] = $state([])
  let searchFilters: InventoryFilters = $state({})
  let inventoryFiltersOpen = $state(false)
  let inventoryViewMode: 'tree' | 'table' = $state('tree')
  let inventoryColumns = $state<InventoryColumn[]>([...DEFAULT_INVENTORY_COLUMNS])
  let inventorySortColumn = $state<InventoryColumn>('name')
  let inventorySortDirection = $state<InventorySortDirection>('asc')
  let searchTotal: number = $state(0)
  let searchHasMore: boolean = $state(false)
  let searchResultIndex: number = $state(0)
  let searching:   boolean       = $state(false)
  let searchLoadingMore: boolean = $state(false)
  let selectedScrollAlign: 'auto' | 'center' = $state('auto')
  let searchInputEl: HTMLInputElement | null = $state(null)

  const inventoryFiltersActive = $derived(hasInventoryFilters(searchFilters))
  const inventoryFilterCount = $derived([
    searchFilters.subtreeId,
    searchFilters.templateId,
    hasPropertyPredicate(searchFilters),
    searchFilters.missingRequired,
  ].filter(Boolean).length)
  const searchActive = $derived(searchQuery.trim().length > 0 || inventoryFiltersActive)
  const searchMatchSet = $derived(new Set(searchResults.map(r => r.nodeId)))
  const searchResultMap = $derived(new Map(searchResults.map(r => [r.nodeId, r])))
  const searchIncludeIds = $derived.by(() => {
    if (!project || !searchActive || searching) return null
    const parentMap = new Map(project.nodes.map(n => [n.id, n.parentId]))
    const ids = new Set<string>()
    for (const result of searchResults) {
      ids.add(result.nodeId)
      let current = parentMap.get(result.nodeId) ?? null
      while (current !== null) {
        ids.add(current)
        current = parentMap.get(current) ?? null
      }
    }
    return ids
  })

  // Inline add-child state
  let addingChildTo: string | null = $state(null)
  let addingChildName: string      = $state('')
  let addingChildError: string | null = $state(null)
  let addingChildTemplateId: string | null = $state(null)
  let addChildInput: HTMLInputElement | null = $state(null)
  // Only structurally-usable templates are offered in the node-create picker.
  const addChildTemplateIds = $derived.by<string[]>(() => {
    const p: Project | null = project
    const map = p?.templates ?? {}
    return Object.keys(map).filter(id => isUsableTemplate(map[id])).sort()
  })

  // Rename request signal — bumping this counter triggers DetailPane.startEditName().
  // Tree raises onRenameRequest → App increments → DetailPane $effect picks it up.
  let renameRequestId = $state(0)

  let moveToNodeId: string | null = $state(null)
  let batchDialogOpen = $state(false)

  // Snapshot/history UI state
  let snapshotPanelOpen: boolean = $state(false)
  let snapshots: Snapshot[] = $state([])
  let snapshotTimelineEvents: SnapshotTimelineEvent[] = $state([])
  let snapshotRecoveryPoints: RecoveryPoint[] = $state([])
  let snapshotLoading: boolean = $state(false)
  let snapshotCreating: boolean = $state(false)
  let snapshotComparing: boolean = $state(false)
  let snapshotRestoringName: string | null = $state(null)
  let snapshotError: string | null = $state(null)
  let snapshotErrorCode: string | null = $state(null)
  let revertDialogSnapshotName: string | null = $state(null)
  let revertDialogNoteRequired: boolean = $state(false)
  let revertDialogError: string | null = $state(null)
  let recoveryDialogPoint: RecoveryPoint | null = $state(null)
  let recoveryApplyingId: string | null = $state(null)
  let recoveryDialogError: string | null = $state(null)
  let workingCopyBaseSnapshot: string | null = $state(null)
  let workingCopyDirty: boolean = $state(false)

  // Compare mode state — separate from normal expanded state so user's tree
  // position is preserved when exiting compare mode.
  let compareMode: boolean = $state(false)
  let mergedTree: MergedTree | null = $state(null)
  let compareExpanded: Set<string> = $state(new Set())

  // Resizable pane widths (px).
  let treeWidth:  number = $state(288)  // 18rem default
  let panelWidth: number = $state(320)  // 20rem default
  let workspaceSettingsLoaded: boolean = $state(false)
  let unsubscribeWindowFocus: (() => void) | null = null
  let unsubscribeLayoutReset: (() => void) | null = null
  let lastCreateDirectory: string | null = $state(null)
  let lastWorkspaceProject: WorkspaceSettings['lastProject'] = $state(null)
  let recentProjects: RecentProject[] = $state([])

  // foldIds the user has manually expanded inside the Space-Folding Lens.
  // Resets on project close / mode flip — handled in those flows below.
  let lensExpandedFolds: Set<string> = $state(new Set())

  // Drag-to-resize state.
  let draggingHandle: 'tree' | 'panel' | null = $state(null)
  let dragStartX = 0
  let dragStartWidth = 0

  function startDrag(handle: 'tree' | 'panel', e: MouseEvent) {
    draggingHandle = handle
    dragStartX = e.clientX
    dragStartWidth = handle === 'tree' ? treeWidth : panelWidth
    e.preventDefault()
  }

  function onDragMove(e: MouseEvent) {
    if (!draggingHandle) return
    const delta = e.clientX - dragStartX
    if (draggingHandle === 'tree') {
      treeWidth = Math.max(160, Math.min(520, dragStartWidth + delta))
    } else {
      // Panel handle is on its left edge — dragging left grows the panel.
      panelWidth = Math.max(240, Math.min(600, dragStartWidth - delta))
    }
  }

  function onDragEnd() {
    draggingHandle = null
  }

  // Non-blocking error toast
  let toastMsg:     string | null = $state(null)
  let toastTimer:   ReturnType<typeof setTimeout> | null = null
  let unsubscribeMenuCommands: (() => void) | null = null
  let unsubscribeProjectOpenFromOs: (() => void) | null = null
  const brandMark = './manifest-mark.svg'
  const WORKSPACE_SETTINGS_SAVE_DELAY_MS = 250
  const desktopChrome = window.api.platform

  // ─── Derived ──────────────────────────────────────────────────────────────

  const tree = $derived.by(() => {
    if (!project) return null
    return buildTree(project.nodes)
  })

  // Subtree change summaries for the lens — populated only in compare mode,
  // so the FoldMarker can show "47 unchanged · 3 added, 2 moved" rollups
  // for collapsed subtrees inside a fold. Pure derivation from mergedTree.
  const compareSubtreeSummaries = $derived.by(() =>
    mergedTree ? computeSubtreeSummaries(mergedTree) : null
  )

  const flatRows = $derived.by(() => {
    if (compareMode && mergedTree) {
      const mergedTreeBuilt = buildTree(mergedTree.nodes)
      if (!mergedTreeBuilt) return []
      return flattenTree(mergedTreeBuilt, compareExpanded, { compareMode: true })
    }
    if (!tree) return []
    return flattenTree(tree, expandedIds, searchIncludeIds ? { includeIds: searchIncludeIds } : {})
  })

  const selectedNode = $derived.by(() => {
    if (!selectedId || !project) return null
    if (compareMode && mergedTree) {
      return mergedTree.nodes.find((node) => node.id === selectedId) ?? null
    }
    return project.nodes.find((node) => node.id === selectedId) ?? null
  })

  const selectedNodes = $derived.by(() =>
    project ? project.nodes.filter(node => selectedIds.has(node.id)) : []
  )

  const detailProject = $derived.by(() => {
    if (!project) return null
    if (compareMode && mergedTree) {
      // Resolve the inspected node's typed fields against the side it belongs
      // to (ghost → from-snapshot templates, live → to-snapshot templates), so
      // a node bound to a template whose schema changed between the two
      // snapshots isn't mislabeled by the inspector. See templatesForNode.
      const templates = templatesForNode(selectedNode, mergedTree)
      return { ...project, nodes: mergedTree.nodes, templates }
    }
    return project
  })

  const projectModeLabel = $derived.by(() => {
    if (compareMode && mergedTree) {
      return `Comparing ${snapshotRefLabel(mergedTree.fromSnapshot)} -> ${snapshotRefLabel(mergedTree.toSnapshot)}`
    }
    if (workingCopyBaseSnapshot) {
      return workingCopyDirty ? 'Unsnapshotted changes' : `Current project matches ${workingCopyBaseSnapshot}`
    }
    return workingCopyDirty ? 'Unsnapshotted changes' : 'Current Project'
  })

  // Tree edits are locked while comparing, reverting, or applying a recovery point.
  // Each of those operations mutates currentProject in main; interleaving a renderer
  // mutation can leave the project in a half-restored state.
  const editingLocked = $derived(
    externalDocumentConflict || undoRedoBusy || snapshotCreating || compareMode || snapshotRestoringName !== null || recoveryApplyingId !== null
  )

  function lockReason(): string {
    if (externalDocumentConflict) return 'Resolve the external project change before editing.'
    if (compareMode) return 'Exit compare to edit the current project.'
    if (snapshotRestoringName) return 'Wait for revert to finish before editing.'
    if (recoveryApplyingId) return 'Wait for recovery to finish before editing.'
    return ''
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  function applyWindowFocus(isFocused: boolean) {
    document.documentElement.dataset.windowFocused = String(isFocused)
  }

  onMount(async () => {
    window.addEventListener('keydown', handleEditKeydown, true)
    document.addEventListener('focusin', updateEditFocus)
    document.addEventListener('focusout', updateEditFocus)
    unsubscribeMenuCommands = window.api.menu.onCommand((command) => {
      void runMenuCommand(command)
    })
    unsubscribeProjectOpenFromOs = window.api.project.onOpenedFromOs((result) => {
      handleProjectOpenedFromOs(result)
    })
    unsubscribeWindowFocus = window.api.windowState.onFocusChanged(applyWindowFocus)
    unsubscribeLayoutReset = window.api.settings.onLayoutReset((settings) => {
      applyWorkspaceSettings(settings)
    })
    const focusState = await window.api.windowState.isFocused()
    if (focusState.ok) applyWindowFocus(focusState.data)

    const settings = await window.api.settings.get()
    if (settings.ok) {
      applyWorkspaceSettings(settings.data)
    } else {
      lastSentWorkspaceSettings = serializeWorkspacePaneSettings(treeWidth, panelWidth)
    }
    workspaceSettingsLoaded = true

    await refreshRecentProjects()

    // Rehydrate if main already has a project open (e.g. macOS activate).
    const result = await window.api.project.getCurrent()
    if (result.ok && result.data) {
      project = result.data
      selectRoot(result.data)
      appState = 'open'
    }

    // Resize drag — registered once here, cleaned up in onDestroy.
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragEnd)
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleEditKeydown, true)
    document.removeEventListener('focusin', updateEditFocus)
    document.removeEventListener('focusout', updateEditFocus)
    unsubscribeMenuCommands?.()
    unsubscribeMenuCommands = null
    unsubscribeProjectOpenFromOs?.()
    unsubscribeProjectOpenFromOs = null
    unsubscribeWindowFocus?.()
    unsubscribeWindowFocus = null
    unsubscribeLayoutReset?.()
    unsubscribeLayoutReset = null
    clearWorkspaceSettingsSaveTimer()
    delete document.documentElement.dataset.windowFocused
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', onDragEnd)
  })

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function selectRoot(p: Project) {
    const root = p.nodes.find(n => n.parentId === null)
    if (root) {
      setSelection(root.id)
      expandedIds = new Set([root.id])
    }
  }

  function showToast(msg: string) {
    toastMsg = msg
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastMsg = null }, 4000)
  }

  // Export the loaded compare as a saved report. Main builds + writes (renderer
  // never touches the filesystem); a canceled save dialog is a silent no-op.
  async function handleExportReport(format: ReportFormat) {
    if (!mergedTree) return
    const res = await window.api.report.export(
      mergedTree.fromSnapshot,
      mergedTree.toSnapshot,
      format,
      mergedTree.scope?.nodeId ?? null,
    )
    if (!res.ok) { showToast(`Export failed: ${res.error.message}`); return }
    if (res.data.savedPath) showToast(`Report saved to ${res.data.savedPath}`)
  }

  // Copy the loaded compare as Markdown. Clipboard is a renderer-side write, not
  // a filesystem touch, so it stays in the renderer.
  async function handleCopyReport() {
    if (!mergedTree) return
    const res = await window.api.report.build(
      mergedTree.fromSnapshot,
      mergedTree.toSnapshot,
      'markdown',
      mergedTree.scope?.nodeId ?? null,
    )
    if (!res.ok) { showToast(`Copy failed: ${res.error.message}`); return }
    try {
      await navigator.clipboard.writeText(res.data.content)
      showToast('Report copied to clipboard')
    } catch {
      showToast('Could not access the clipboard')
    }
  }

  async function focusInput(el: HTMLInputElement | null) {
    await tick()
    el?.focus()
    el?.select()
  }

  $effect(() => {
    if (addingChildTo) {
      void focusInput(addChildInput)
    }
  })

  function applyProject(p: Project) {
    project = p
    // Search results are computed against the previous project; once the
    // project mutates, stale match ids can point at deleted or moved nodes.
    if (searchActive) clearSearch()
    // If selected node was deleted, fall back to root.
    // Ghost selections (issue #3) live in mergedTree.nodes, not project.nodes,
    // so don't clobber them just because the live project mutated.
    const isGhostSelection = selectedId?.startsWith('ghost:') ?? false
    if (!isGhostSelection) {
      const liveIds = new Set(p.nodes.map(node => node.id))
      selectedIds = new Set([...selectedIds].filter(id => liveIds.has(id)))
      selectionRecency = selectionRecency.filter(id => liveIds.has(id))
      if (selectionAnchorId && !liveIds.has(selectionAnchorId)) selectionAnchorId = null
    }
    if (selectedId && !isGhostSelection && !p.nodes.find(n => n.id === selectedId)) {
      const root = p.nodes.find(n => n.parentId === null)
      setSelection(root?.id ?? null)
    }
  }

  function markWorkingCopyChanged() {
    workingCopyDirty = true
  }

  async function reloadCurrentProject() {
    const result = await window.api.project.getCurrent()
    if (result.ok && result.data) {
      applyProject(result.data)
    }
  }

  function handleProjectOpenedFromOs(result: Awaited<ReturnType<typeof window.api.project.open>>) {
    if (!result.ok) {
      error = result.error.message
      showToast(result.error.message)
      return
    }

    resetOpenProjectUi()
    applyOpenedProject(result.data)
    error = null
  }

  function resetOpenProjectUi() {
    clearSearch()
    snapshotPanelOpen = false
    snapshots = []
    snapshotTimelineEvents = []
    snapshotRecoveryPoints = []
    snapshotError = null
    snapshotLoading = false
    snapshotCreating = false
    snapshotComparing = false
    snapshotRestoringName = null
    revertDialogSnapshotName = null
    revertDialogNoteRequired = false
    revertDialogError = null
    recoveryDialogPoint = null
    recoveryDialogError = null
    recoveryApplyingId = null
    workingCopyBaseSnapshot = null
    workingCopyDirty = false
    compareMode = false
    mergedTree = null
    compareExpanded = new Set()
    lensExpandedFolds = new Set()
    importDialogOpen = false
    importBaseParent = null
    importSummary = null
    importSummaryDismissed = false
    templateManagerOpen = false
    duplicateNodeId = null
    batchDialogOpen = false
    moveToNodeId = null
    addingChildTo = null
    addingChildName = ''
    addingChildError = null
    addingChildTemplateId = null
    stashedGhostSelection = null
  }

  function beginCreateProject() {
    if (project) {
      showToast('Close the current project before creating a new project.')
      return
    }
    newPath = lastCreateDirectory ?? ''
    appState = 'creating'
    error = null
  }

  async function saveCurrentProject() {
    if (!project) return
    const result = await window.api.project.save()
    if (result.ok) showToast('Project saved')
    else showToast(result.error.message)
  }

  async function focusSearch() {
    if (!project || compareMode) return
    await tick()
    searchInputEl?.focus()
    searchInputEl?.select()
  }

  async function reindexHistory() {
    if (!project) return
    const result = await window.api.node.historyReindex()
    if (result.ok) showToast('History index refreshed')
    else showToast(result.error.message)
  }

  function buildMenuCommandState(): MenuCommandState {
    const state = createDisabledMenuCommandState()
    const hasOpenProject = appState === 'open' && project !== null
    const projectBusy = duplicateNodeId !== null || batchDialogOpen || undoRedoBusy || snapshotCreating || snapshotRestoringName !== null || recoveryApplyingId !== null
    const canUseProject = hasOpenProject && !projectBusy
    const canEditProject = canUseProject && !editingLocked
    const selectedLiveNode = canEditProject && selectedIds.size === 1 && selectedNode && !selectedId?.startsWith('ghost:')
      ? selectedNode
      : null
    const selectedEditableChild = selectedLiveNode !== null && selectedLiveNode.parentId !== null
    const compareLoaded = hasOpenProject && compareMode && mergedTree !== null
    const canMutateSelectedChild = Boolean(selectedEditableChild) && !textEditing &&
      !importDialogOpen && !templateManagerOpen && !moveToNodeId && !addingChildTo &&
      !snapshotComparing && !revertDialogSnapshotName && !recoveryDialogPoint

    state['project:undo'] = textEditing || (canUndoProject && editHistory.undoLabel !== null)
    state['project:redo'] = textEditing || (canUndoProject && editHistory.redoLabel !== null)
    state['project:new'] = appState === 'welcome' && project === null
    state['project:open'] = appState !== 'loading' && appState !== 'creating' && !creating && !projectBusy
    state['project:save'] = canUseProject
    state['project:close'] = canUseProject
    state['project:import'] = canEditProject
    state['project:templates'] = canEditProject
    state['project:snapshots'] = canUseProject
    state['project:search'] = canUseProject && !compareMode
    state['compare:exit'] = compareLoaded && !projectBusy
    state['report:copyMarkdown'] = compareLoaded && !projectBusy
    state['report:exportMarkdown'] = compareLoaded && !projectBusy
    state['report:exportCsv'] = compareLoaded && !projectBusy
    state['report:exportHtml'] = compareLoaded && !projectBusy
    state['node:addChild'] = selectedLiveNode !== null
    state['node:rename'] = selectedLiveNode !== null
    state['node:duplicate'] = canMutateSelectedChild
    state['node:moveTo'] = canMutateSelectedChild
    state['node:delete'] = canMutateSelectedChild
    state['history:reindex'] = canUseProject

    return state
  }

  function canRunMenuCommand(command: MenuCommandId): boolean {
    return buildMenuCommandState()[command]
  }

  async function runMenuCommand(command: MenuCommandId) {
    if (command === 'project:undo' || command === 'project:redo') {
      const direction = command === 'project:undo' ? 'undo' : 'redo'
      if (isTextEditing(document.activeElement)) await window.api.text.undoRedo(direction)
      else await applyUndoRedo(direction)
      return
    }
    if (!canRunMenuCommand(command)) return

    switch (command) {
      case 'project:new':
        beginCreateProject()
        return
      case 'project:open':
        await openProject()
        return
      case 'project:save':
        await saveCurrentProject()
        return
      case 'project:close':
        await closeProject()
        return
      case 'project:import':
        openImportDialog()
        return
      case 'project:templates':
        openTemplateManager()
        return
      case 'project:snapshots':
        await toggleSnapshots()
        return
      case 'project:search':
        await focusSearch()
        return
      case 'compare:exit':
        exitCompareMode()
        return
      case 'report:copyMarkdown':
        await handleCopyReport()
        return
      case 'report:exportMarkdown':
        await handleExportReport('markdown')
        return
      case 'report:exportCsv':
        await handleExportReport('csv')
        return
      case 'report:exportHtml':
        await handleExportReport('html')
        return
      case 'node:addChild':
        if (selectedNode && !selectedId?.startsWith('ghost:')) handleAddChild(selectedNode.id)
        return
      case 'node:rename':
        handleRenameRequest()
        return
      case 'node:duplicate':
        if (selectedNode) handleDuplicate(selectedNode.id)
        return
      case 'node:moveTo':
        if (selectedNode && !selectedId?.startsWith('ghost:')) handleMoveTo(selectedNode.id)
        return
      case 'node:delete':
        if (selectedNode && !selectedId?.startsWith('ghost:')) await handleDelete(selectedNode.id)
        return
      case 'history:reindex':
        await reindexHistory()
        return
    }
  }

  // Push enabled/disabled state to the native menu, but only when it actually
  // changes — the effect re-runs on every reactive dependency, and most UI
  // interactions leave the command map identical. Skipping no-op sends avoids a
  // high volume of redundant IPC messages and native menu mutations.
  let lastSentMenuState = ''
  $effect(() => {
    const next = buildMenuCommandState()
    const serialized = JSON.stringify(next)
    if (serialized === lastSentMenuState) return
    lastSentMenuState = serialized
    window.api.menu.updateState(next)
  })

  let lastSentWorkspaceSettings = ''
  let workspaceSettingsSaveTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    if (!workspaceSettingsLoaded) return
    const serialized = serializeWorkspacePaneSettings(treeWidth, panelWidth)
    if (serialized === lastSentWorkspaceSettings) {
      clearWorkspaceSettingsSaveTimer()
      return
    }
    clearWorkspaceSettingsSaveTimer()
    workspaceSettingsSaveTimer = setTimeout(() => {
      workspaceSettingsSaveTimer = null
      const next = { treeWidth: Math.round(treeWidth), panelWidth: Math.round(panelWidth) }
      const nextSerialized = serializeWorkspacePaneSettings(next.treeWidth, next.panelWidth)
      if (nextSerialized === lastSentWorkspaceSettings) return
      lastSentWorkspaceSettings = nextSerialized
      void window.api.settings.updateWorkspace(next)
    }, WORKSPACE_SETTINGS_SAVE_DELAY_MS)
  })

  // ─── Welcome actions ──────────────────────────────────────────────────────

  async function refreshRecentProjects() {
    const result = await window.api.recentProjects.list()
    if (result.ok) recentProjects = result.data
  }

  async function openProject() {
    error = null
    const folderPath = await window.api.dialog.openFolder('Open Project', 'open-project')
    if (!folderPath) return

    const fallbackState = project ? 'open' : 'welcome'
    if (project) {
      const saved = await window.api.project.save()
      if (!saved.ok) {
        error = saved.error.message
        showToast(saved.error.message)
        return
      }
    }

    appState = 'loading'
    const result = await window.api.project.open(folderPath)
    if (result.ok) {
      resetOpenProjectUi()
      applyOpenedProject(result.data)
    } else {
      error = result.error.message
      appState = fallbackState
    }
  }

  async function openExampleProject() {
    error = null
    const fallbackState = project ? 'open' : 'welcome'
    appState = 'loading'
    const result = await window.api.project.openExample()
    if (result.ok) {
      resetOpenProjectUi()
      applyOpenedProject(result.data)
    } else {
      error = result.error.message
      appState = fallbackState
    }
  }

  async function openRecentProject(recentProject: RecentProject) {
    if (!recentProject.exists) return
    error = null
    appState = 'loading'
    const result = await window.api.project.open(recentProject.path)
    if (result.ok) {
      resetOpenProjectUi()
      applyOpenedProject(result.data)
    } else {
      error = result.error.message
      appState = 'welcome'
      recentProjects = recentProjects.map(entry =>
        entry.path === recentProject.path ? { ...entry, exists: false } : entry
      )
    }
  }

  async function selectFolder() {
    const folderPath = await window.api.dialog.openFolder('Choose Location', 'create-project')
    if (folderPath) {
      newPath = folderPath
      lastCreateDirectory = folderPath
    }
  }

  async function createProject() {
    if (!newName.trim() || !newPath) return
    creating = true
    error = null
    const result = await window.api.project.create(newName.trim(), newPath)
    creating = false
    if (result.ok) {
      applyOpenedProject(result.data)
    } else {
      error = result.error.message
    }
  }

  async function closeProject() {
    const result = await window.api.project.close()
    if (!result.ok) {
      error = result.error.message
      showToast(result.error.message)
      return
    }
    project = null
    setSelection(null)
    expandedIds = new Set()
    clearSearch()
    appState = 'welcome'
    newName = ''
    newPath = ''
    error = null
    snapshotPanelOpen = false
    snapshots = []
    snapshotError = null
    workingCopyBaseSnapshot = null
    workingCopyDirty = false
    compareMode = false
    mergedTree = null
    compareExpanded = new Set()
    lensExpandedFolds = new Set()
    // stashedGhostSelection already cleared by setSelection(null) above.
  }

  function applyOpenedProject(openedProject: Project) {
    project = openedProject
    selectRoot(openedProject)
    workingCopyBaseSnapshot = null
    workingCopyDirty = false
    loadWarningsDismissed = false
    projectWarningsDismissed = false
    appState = 'open'
    if (openedProject.path) {
      lastWorkspaceProject = {
        path: openedProject.path,
        name: openedProject.name,
        exists: true,
      }
    }
    void refreshRecentProjects()
  }

  function applyWorkspaceSettings(settings: WorkspaceSettings) {
    treeWidth = settings.treeWidth
    panelWidth = settings.panelWidth
    lastSentWorkspaceSettings = serializeWorkspacePaneSettings(settings.treeWidth, settings.panelWidth)
    lastCreateDirectory = settings.lastCreateDirectory
    lastWorkspaceProject = settings.lastProject
  }

  function clearWorkspaceSettingsSaveTimer() {
    if (!workspaceSettingsSaveTimer) return
    clearTimeout(workspaceSettingsSaveTimer)
    workspaceSettingsSaveTimer = null
  }

  function serializeWorkspacePaneSettings(nextTreeWidth: number, nextPanelWidth: number): string {
    return JSON.stringify({
      treeWidth: Math.round(nextTreeWidth),
      panelWidth: Math.round(nextPanelWidth),
    })
  }

  // ─── Tree actions ─────────────────────────────────────────────────────────

  /**
   * Single entry point for changing `selectedId`. Always invalidates any
   * stashed ghost selection (issue #3): an explicit selection — whether
   * triggered by tree click, search, add-child, or diff-row navigation —
   * means the user has moved on, so don't surprise them by restoring a
   * stale ghost the next time compare mode is re-entered.
   *
   * Inside compare mode the stash is already null (handleSnapshotCompare
   * consumes it on entry), so the clear is a no-op there.
   */
  function setSelection(id: string | null): void {
    selectedId = id
    selectedIds = id ? new Set([id]) : new Set()
    selectionRecency = id ? [id] : []
    selectionAnchorId = id
    stashedGhostSelection = null
  }

  function handleSelect(id: string, modifiers?: { toggle: boolean; range: boolean }) {
    selectedScrollAlign = 'auto'
    if (compareMode || id.startsWith('ghost:') || (!modifiers?.toggle && !modifiers?.range)) {
      setSelection(id)
    } else if (modifiers.range && selectedId) {
      const visibleIds = flatRows.filter(row => !row.id.startsWith('ghost:')).map(row => row.node.id)
      const anchor = visibleIds.indexOf(selectionAnchorId ?? selectedId)
      const target = visibleIds.indexOf(id)
      if (anchor >= 0 && target >= 0) {
        const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
        selectedIds = new Set(visibleIds.slice(start, end + 1))
        selectedId = id
        selectionRecency = [...selectionRecency.filter(candidate => selectedIds.has(candidate) && candidate !== id), id]
        stashedGhostSelection = null
      } else setSelection(id)
    } else {
      const next = new Set(selectedIds)
      if (next.has(id)) {
        next.delete(id)
        selectionRecency = selectionRecency.filter(candidate => candidate !== id)
      } else {
        next.add(id)
        selectionRecency = [...selectionRecency.filter(candidate => candidate !== id), id]
      }
      selectedIds = next
      selectedId = next.has(id)
        ? id
        : [...selectionRecency].reverse().find(candidate => next.has(candidate)) ?? [...next][0] ?? null
      selectionAnchorId = selectedId
      stashedGhostSelection = null
    }
    addingChildTo = null
  }

  function handleToggle(id: string) {
    if (compareMode) {
      const next = new Set(compareExpanded)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      compareExpanded = next
    } else {
      const next = new Set(expandedIds)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      expandedIds = next
    }
  }

  function handleAddChild(parentId: string) {
    if (editingLocked) {
      showToast(lockReason())
      return
    }
    addingChildTo = parentId
    addingChildName = ''
    addingChildError = null
    addingChildTemplateId = null
    expandedIds = new Set([...expandedIds, parentId])
  }

  async function commitAddChild() {
    if (editingLocked) {
      showToast(lockReason())
      return
    }
    if (!addingChildTo || !addingChildName.trim()) {
      addingChildError = 'Name is required'
      return
    }
    const result = await window.api.node.create(
      addingChildTo,
      addingChildName.trim(),
      addingChildTemplateId,
    )
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
      // Select the new node (last child of parent).
      const newNode = result.data.nodes
        .filter(n => n.parentId === addingChildTo)
        .sort((a, b) => b.order - a.order)[0]
      if (newNode) setSelection(newNode.id)
      addingChildTo = null
      addingChildName = ''
      addingChildTemplateId = null
    } else {
      addingChildError = result.error.message
    }
  }

  function cancelAddChild() {
    addingChildTo = null
    addingChildName = ''
    addingChildError = null
    addingChildTemplateId = null
  }

  async function handleMoveUp(id: string) {
    if (!project || editingLocked) return
    const idx = getSiblingIndex(id, project.nodes)
    if (idx <= 0) return
    const result = await window.api.node.move(id, project.nodes.find(n => n.id === id)!.parentId!, idx - 1)
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
    }
    else showToast(result.error.message)
  }

  async function handleMoveDown(id: string) {
    if (!project || editingLocked) return
    const node = project.nodes.find(n => n.id === id)
    if (!node) return
    const siblings = project.nodes.filter(n => n.parentId === node.parentId)
    const idx = getSiblingIndex(id, project.nodes)
    if (idx >= siblings.length - 1) return
    const result = await window.api.node.move(id, node.parentId!, idx + 1)
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
    }
    else showToast(result.error.message)
  }

  function handleDuplicate(id: string) {
    if (!project || editingLocked || duplicateNodeId) return
    const source = project.nodes.find(node => node.id === id)
    if (source?.parentId) duplicateNodeId = id
  }

  async function confirmDuplicate(name: string): Promise<string | null> {
    const source = duplicateNode
    if (!project || !source || editingLocked) return 'The source node is no longer available.'
    const originalIds = new Set(project.nodes.map(node => node.id))
    const result = await window.api.node.duplicate(source.id, name)
    if (!result.ok) return result.error.message
    applyProject(result.data)
    markWorkingCopyChanged()
    duplicateNodeId = null
    const copy = result.data.nodes.find(node => !originalIds.has(node.id) && node.parentId === source.parentId)
    if (copy) {
      expandedIds = new Set([...expandedIds, ...getAncestorIds(copy.id, result.data.nodes), copy.id])
      setSelection(copy.id)
      selectedScrollAlign = 'center'
    }
    return null
  }

  function openBatchPropertyDialog() {
    if (editingLocked || selectedNodes.length < 2) return
    batchDialogOpen = true
  }

  async function confirmBatchPropertyUpdate(request: BatchPropertyUpdateRequest): Promise<string | null> {
    if (!project || editingLocked || selectedNodes.length < 2) return 'The selection is no longer available.'
    const result = await window.api.node.batchUpdateProperties(request)
    if (!result.ok) return result.error.message
    applyProject(result.data.project)
    markWorkingCopyChanged()
    batchDialogOpen = false
    showToast(`Updated ${result.data.changesApplied} selected node${result.data.changesApplied === 1 ? '' : 's'}`)
    return null
  }

  function handleMoveTo(id: string) {
    if (editingLocked) {
      showToast(lockReason())
      return
    }
    moveToNodeId = id
  }

  async function confirmMoveTo(targetParentId: string) {
    if (!moveToNodeId || editingLocked) return
    const result = await window.api.node.move(moveToNodeId, targetParentId, 999)
    moveToNodeId = null
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
    }
    else showToast(result.error.message)
  }

  async function handleDelete(id: string) {
    if (!project || editingLocked) return
    const node = project.nodes.find(n => n.id === id)
    if (!node) return

    const children = project.nodes.filter(n => n.parentId === id)
    const descendantCount = getDescendantCount(id, project.nodes)

    if (descendantCount > 0) {
      const confirmed = window.confirm(
        `Delete "${node.name}" and its ${descendantCount} descendant${descendantCount === 1 ? '' : 's'}?`
      )
      if (!confirmed) return
    }

    const result = await window.api.node.delete(id)
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
      return
    }

    // Blocked by incoming references? Offer to clear them and force the delete.
    // Validate the shape — context crosses the IPC boundary as unknown.
    const rawBlockers = result.error.context?.blockers
    const blockers = Array.isArray(rawBlockers) ? (rawBlockers as ReferenceBlocker[]) : []
    if (blockers.length > 0) {
      const list = blockers
        .map(b => {
          const holder = b.kind === 'template-default' ? `Template "${b.nodeName}" default` : b.nodeName
          return `• ${holder} → ${b.key} (→ ${b.targetName})`
        })
        .join('\n')
      // Count distinct holders for accurate copy: a holder may contribute more
      // than one blocker (multiple reference keys), and template defaults aren't
      // nodes — so blockers.length is not a node count.
      const n = blockers.length
      const ref = `reference${n === 1 ? '' : 's'}`
      const confirmed = window.confirm(
        `"${node.name}" has ${n} incoming ${ref}:\n\n${list}\n\n` +
        `Delete "${node.name}" and clear ${n === 1 ? 'it' : `all ${n}`}?`
      )
      if (!confirmed) return
      const forced = await window.api.node.delete(id, { unlinkReferences: true })
      if (forced.ok) {
        applyProject(forced.data)
        markWorkingCopyChanged()
      }
      else showToast(forced.error.message)
      return
    }

    showToast(result.error.message)
  }

  function handleRenameRequest() {
    if (editingLocked) {
      showToast(lockReason())
      return
    }
    // Bump the signal counter — DetailPane's $effect will call startEditName().
    renameRequestId += 1
  }

  async function handleNodeUpdate(
    id: string,
    changes: {
      name?: string
      properties?: Record<string, string | number | boolean | null>
      templateId?: string | null
    }
  ) {
    if (editingLocked) {
      showToast(lockReason())
      return
    }
    const result = await window.api.node.update(id, changes)
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
    }
    else showToast(result.error.message)
  }

  // Promote an ad-hoc property to a typed field on the node's template.
  async function handlePromoteField(nodeId: string, key: string, type: PropertyType) {
    if (!project || editingLocked) { showToast(lockReason()); return }
    const node = project.nodes.find(n => n.id === nodeId)
    const templateId = node?.templateId ?? null
    if (!templateId) { showToast('Assign a template before promoting a property.'); return }
    const template = project.templates?.[templateId]
    if (!template) { showToast('Template not found.'); return }

    // $state.snapshot: template.fields is a deep Svelte proxy; nested field
    // objects must be plain to survive structured-clone across the IPC boundary.
    const existingFields = $state.snapshot(template.fields) as Record<string, NodeTemplate['fields'][string]>
    const nextFields = { ...existingFields, [key]: { type } }
    const result = await window.api.template.update(templateId, { fields: nextFields })
    if (result.ok) {
      applyProject(result.data)
      markWorkingCopyChanged()
    } else {
      showToast(result.error.message)
    }
  }

  // ─── Templates ──────────────────────────────────────────────────────────────

  let templateManagerOpen = $state(false)

  // Load-time warnings (typed-value/integrity issues found when opening a
  // hand-edited manifest). Delivered once on open; cleared by any mutation.
  let loadWarningsDismissed = $state(false)
  const loadWarnings = $derived.by<ManifestWarning[]>(() => {
    const p: Project | null = project
    return p?.loadWarnings ?? []
  })
  const showLoadWarnings = $derived(loadWarnings.length > 0 && !loadWarningsDismissed)

  let projectWarningsDismissed = $state(false)
  const projectWarnings = $derived.by<ProjectWarning[]>(() => {
    const p: Project | null = project
    return p?.projectWarnings ?? []
  })
  const showProjectWarnings = $derived(projectWarnings.length > 0 && !projectWarningsDismissed)

  function openTemplateManager() {
    if (editingLocked) { showToast(lockReason()); return }
    templateManagerOpen = true
  }

  async function handleTemplateCreate(id: string, template: NodeTemplate): Promise<string | null> {
    const result = await window.api.template.create(id, template)
    if (result.ok) { applyProject(result.data); markWorkingCopyChanged(); return null }
    return result.error.message
  }

  async function handleTemplateUpdate(id: string, template: NodeTemplate): Promise<string | null> {
    const result = await window.api.template.update(id, template)
    if (result.ok) { applyProject(result.data); markWorkingCopyChanged(); return null }
    return result.error.message
  }

  async function handleTemplateDelete(id: string): Promise<string | null> {
    const result = await window.api.template.delete(id)
    if (result.ok) { applyProject(result.data); markWorkingCopyChanged(); return null }
    return result.error.message
  }

  // ─── CSV import ───────────────────────────────────────────────────────────────

  let importDialogOpen = $state(false)
  let importBaseParent = $state<ManifestNode | null>(null)
  let importSummary = $state<ImportResult | null>(null)
  let importSummaryDismissed = $state(false)
  const showImportSummary = $derived(importSummary !== null && !importSummaryDismissed)

  function resolveBaseParent(node?: ManifestNode): ManifestNode | null {
    if (!project) return null
    if (node) return node
    const sel = selectedId ? project.nodes.find(n => n.id === selectedId) : undefined
    return sel ?? project.nodes.find(n => n.parentId === null) ?? null
  }

  function openImportDialog(node?: ManifestNode) {
    if (editingLocked) { showToast(lockReason()); return }
    const base = resolveBaseParent(node)
    if (!base) return
    importBaseParent = base
    importDialogOpen = true
  }

  function handleImportHere(id: string) {
    const node = project?.nodes.find(n => n.id === id)
    openImportDialog(node)
  }

  function handleImported(next: Project, summary: ImportResult) {
    applyProject(next)
    markWorkingCopyChanged()
    // Reveal the imported rows by expanding the base parent (flat imports land
    // directly under it; path imports go deeper, but expanding the base is a
    // sensible starting point).
    if (importBaseParent) expandedIds = new Set([...expandedIds, importBaseParent.id])
    importSummary = summary
    importSummaryDismissed = false
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchRequestId = 0
  const searchPageSize = 50

  function revealSearchResult(index = searchResultIndex): void {
    const result = searchResults[index]
    if (!result) return
    searchResultIndex = index
    selectedScrollAlign = 'center'
    setSelection(result.nodeId)
  }

  function cycleSearchResult(reverse: boolean): void {
    if (searchResults.length === 0) return
    if (!reverse && searchResultIndex === searchResults.length - 1 && searchHasMore) {
      void loadMoreSearchResults(true)
      return
    }
    const next = cycleIndex(searchResultIndex, searchResults.length, reverse)
    revealSearchResult(next)
  }

  function runSearch(query: string): void {
    if (searchTimer) clearTimeout(searchTimer)
    const requestId = ++searchRequestId
    if (!query.trim() && !hasInventoryFilters(searchFilters)) {
      searchResults = []
      searchTotal = 0
      searchHasMore = false
      searchResultIndex = 0
      searching = false
      searchLoadingMore = false
      return
    }
    searching = true
    searchLoadingMore = false
    searchResults = []
    searchTotal = 0
    searchHasMore = false
    searchResultIndex = 0
    const filters = { ...searchFilters }
    const filterSignature = JSON.stringify(filters)
    searchTimer = setTimeout(async () => {
      const result = await window.api.search.query(query, 0, searchPageSize, filters)
      if (
        requestId !== searchRequestId ||
        query !== searchQuery ||
        filterSignature !== JSON.stringify(searchFilters)
      ) return
      searching = false
      if (result.ok) {
        searchResults = result.data.results
        searchTotal = result.data.total
        searchHasMore = result.data.hasMore
        searchResultIndex = 0
        await tick()
        revealSearchResult(0)
      }
    }, 200)
  }

  async function loadMoreSearchResults(selectFirstNew = false): Promise<void> {
    if (searching || searchLoadingMore || !searchHasMore) return
    const query = searchQuery
    const requestId = searchRequestId
    const offset = searchResults.length
    const expectedTotal = searchTotal
    const filters = { ...searchFilters }
    const filterSignature = JSON.stringify(filters)
    searchLoadingMore = true
    try {
      const result = await window.api.search.query(query, offset, searchPageSize, filters)
      if (
        requestId !== searchRequestId ||
        query !== searchQuery ||
        filterSignature !== JSON.stringify(searchFilters)
      ) return
      if (!result.ok) {
        showToast(result.error.message)
        return
      }
      if (result.data.offset !== offset || result.data.total !== expectedTotal) {
        showToast('Search results changed and were refreshed.')
        runSearch(query)
        return
      }
      searchResults = [...searchResults, ...result.data.results]
      searchTotal = result.data.total
      searchHasMore = result.data.hasMore
      if (selectFirstNew && result.data.results.length > 0) {
        await tick()
        revealSearchResult(offset)
      }
    } finally {
      if (requestId === searchRequestId) searchLoadingMore = false
    }
  }

  function handleSearchInput(e: Event) {
    searchQuery = (e.target as HTMLInputElement).value
    runSearch(searchQuery)
  }

  function handleInventoryFiltersChange(filters: InventoryFilters): void {
    searchFilters = filters
    runSearch(searchQuery)
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (!searchActive) return
      e.preventDefault()
      clearSearch()
      searchInputEl?.focus()
      return
    }
    if (e.key === 'Enter') {
      if (!searchActive) return
      e.preventDefault()
      cycleSearchResult(e.shiftKey)
    }
  }

  function handleSearchShortcutInput(ch: string) {
    if (compareMode) return
    searchQuery += ch
    searchInputEl?.focus()
    runSearch(searchQuery)
  }

  function clearSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchRequestId++
    searchQuery = ''
    searchFilters = {}
    inventoryFiltersOpen = false
    searchResults = []
    searchTotal = 0
    searchHasMore = false
    searchResultIndex = 0
    searching = false
    searchLoadingMore = false
  }

  // ─── Snapshots / history ────────────────────────────────────────────────

  async function refreshSnapshots() {
    if (!project) return
    snapshotLoading = true
    snapshotError = null
    snapshotErrorCode = null

    const [result, timelineResult] = await Promise.all([
      window.api.snapshot.list(),
      window.api.snapshot.timeline(),
    ])
    snapshotLoading = false

    if (result.ok) {
      snapshots = result.data
    } else {
      snapshots = []
      snapshotError = result.error.message
      snapshotErrorCode = result.error.code
    }

    if (timelineResult.ok) {
      snapshotTimelineEvents = timelineResult.data.events
      snapshotRecoveryPoints = timelineResult.data.recoveryPoints
    } else {
      snapshotTimelineEvents = []
      snapshotRecoveryPoints = []
      snapshotError = timelineResult.error.message
      snapshotErrorCode = timelineResult.error.code
    }
  }

  async function openSnapshots() {
    snapshotPanelOpen = true
    await refreshSnapshots()
  }

  async function toggleSnapshots() {
    if (snapshotPanelOpen) {
      closeSnapshots()
      return
    }
    await openSnapshots()
  }

  function closeSnapshots() {
    snapshotPanelOpen = false
    snapshotError = null
    snapshotCreating = false
    snapshotComparing = false
    snapshotRestoringName = null
    exitCompareMode()
  }

  function exitCompareMode() {
    compareMode = false
    mergedTree = null
    compareExpanded = new Set()
    // If a ghost is selected, stash it so we can restore on re-entering
    // compare mode (issue #3). Then fall back to a live selection.
    //
    // NB: the assignments below intentionally bypass setSelection() — that
    // helper clears stashedGhostSelection, which would defeat the stash we
    // just set. The stash is consumed by handleSnapshotCompare on re-entry.
    if (selectedId?.startsWith('ghost:')) {
      stashedGhostSelection = selectedId
      const root = project?.nodes.find(node => node.parentId === null)
      selectedId = root?.id ?? null
      selectedIds = selectedId ? new Set([selectedId]) : new Set()
      selectionRecency = selectedId ? [selectedId] : []
      selectionAnchorId = selectedId
    } else if (project && selectedId && !project.nodes.find(node => node.id === selectedId)) {
      const root = project.nodes.find(node => node.parentId === null)
      selectedId = root?.id ?? null
      selectedIds = selectedId ? new Set([selectedId]) : new Set()
      selectionRecency = selectedId ? [selectedId] : []
      selectionAnchorId = selectedId
    }
  }

  function resolveCompareSelectionId(nodeId: string): string {
    if (!mergedTree) return nodeId
    if (mergedTree.nodes.some(node => node.id === nodeId)) return nodeId

    const ghostId = `ghost:${nodeId}`
    if (mergedTree.nodes.some(node => node.id === ghostId)) return ghostId

    return nodeId
  }

  async function handleSnapshotCreate(name: string, description: string | null): Promise<boolean> {
    snapshotCreating = true
    snapshotError = null
    const result = await window.api.snapshot.create(name, description)
    snapshotCreating = false

    if (result.ok) {
      workingCopyBaseSnapshot = result.data.name
      workingCopyDirty = false
      await refreshSnapshots()
      showToast(`Snapshot "${result.data.name}" created`)
      return true
    } else {
      snapshotError = result.error.message
      snapshotErrorCode = result.error.code
      return false
    }
  }

  async function handleSnapshotCompare(from: string, to: string, scopeNodeId: string | null) {
    snapshotComparing = true
    snapshotError = null
    const result = await window.api.snapshot.loadCompare(from, to, scopeNodeId)
    snapshotComparing = false

    if (result.ok) {
      mergedTree = result.data
      // Seed compareExpanded from normalExpanded ∪ ancestors of every changed node.
      const changedIds = result.data.nodes
        .filter(n => n.status !== 'unchanged')
        .map(n => n.id)
      const ancestors = new Set<string>()
      for (const id of changedIds) {
        for (const aid of getAncestorIds(id, result.data.nodes)) ancestors.add(aid)
        ancestors.add(id)
      }
      compareExpanded = new Set([...expandedIds, ...ancestors])
      compareMode = true
      selectedIds = selectedId ? new Set([selectedId]) : new Set()
      selectionRecency = selectedId ? [selectedId] : []
      selectionAnchorId = selectedId
      if (result.data.scope) {
        const scopedSelectionId = result.data.nodes.some(node => node.id === result.data.scope!.nodeId)
          ? result.data.scope.nodeId
          : `ghost:${result.data.scope.nodeId}`
        selectedId = scopedSelectionId
        selectedIds = new Set([scopedSelectionId])
        selectionRecency = [scopedSelectionId]
        selectionAnchorId = scopedSelectionId
        const scopeAncestors = getAncestorIds(scopedSelectionId, result.data.nodes)
        compareExpanded = new Set([...compareExpanded, ...scopeAncestors, scopedSelectionId])
      }
      clearSearch()  // search is a browse-mode aid; don't carry it into compare

      // Restore a stashed ghost selection if this snapshot pair still
      // contains the same ghost id (issue #3). Otherwise drop the stash —
      // a different comparison shouldn't carry a stale ghost selection.
      //
      // NB: assigns selectedId directly (not via setSelection) because the
      // stash is explicitly cleared two lines below; routing through the
      // helper would clear it before the side effects below could run.
      if (stashedGhostSelection) {
        if (result.data.nodes.some(n => n.id === stashedGhostSelection)) {
          selectedId = stashedGhostSelection
          selectedIds = new Set([stashedGhostSelection])
          selectionRecency = [stashedGhostSelection]
          selectionAnchorId = stashedGhostSelection
          // Expand ancestors so the restored ghost is visible.
          const ghostAncestors = getAncestorIds(stashedGhostSelection, result.data.nodes)
          compareExpanded = new Set([...compareExpanded, ...ghostAncestors, stashedGhostSelection])
        }
        stashedGhostSelection = null
      }
    } else {
      snapshotError = result.error.message
      snapshotErrorCode = result.error.code
    }
  }

  /** Called when user clicks a diff row — selects that node in the tree. */
  function handleDiffNodeSelect(nodeId: string) {
    if (compareMode && mergedTree) {
      const compareSelectionId = resolveCompareSelectionId(nodeId)
      // Inside compare mode, the stash is already null (handleSnapshotCompare
      // consumed it on entry), so setSelection's clear is a defensive no-op.
      setSelection(compareSelectionId)
      const ancestors = getAncestorIds(compareSelectionId, mergedTree.nodes)
      compareExpanded = new Set([...compareExpanded, ...ancestors, compareSelectionId])
    } else if (project) {
      setSelection(nodeId)
      const ancestors = getAncestorIds(nodeId, project.nodes)
      expandedIds = new Set([...expandedIds, ...ancestors, nodeId])
    }
  }

  async function handleSnapshotRestore(name: string) {
    revertDialogSnapshotName = name
    revertDialogNoteRequired = false
    revertDialogError = null
    snapshotError = null
  }

  async function confirmSnapshotRevert(note: string | null) {
    const name = revertDialogSnapshotName
    if (!name) return
    snapshotRestoringName = name
    snapshotError = null
    revertDialogError = null

    try {
      const result = await window.api.snapshot.revert({ name, note })

      if (!result.ok && result.error.code === 'VALIDATION_FAILED' && result.error.message.includes('revert note is required')) {
        snapshotRestoringName = null
        revertDialogNoteRequired = true
        revertDialogError = result.error.message
        return
      }

      snapshotRestoringName = null

      if (result.ok) {
        revertDialogSnapshotName = null
        revertDialogNoteRequired = false
        revertDialogError = null
        await reloadCurrentProject()
        await refreshSnapshots()
        exitCompareMode()
        workingCopyBaseSnapshot = name
        workingCopyDirty = false
        showToast(`Reverted current project to "${name}"`)
      } else {
        revertDialogError = result.error.message
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      snapshotRestoringName = null
      revertDialogError = `Failed to revert snapshot: ${message}`
    }
  }

  function cancelSnapshotRevert() {
    if (snapshotRestoringName) return
    revertDialogSnapshotName = null
    revertDialogNoteRequired = false
    revertDialogError = null
  }

  async function handleApplyRecovery(id: string) {
    const recoveryPoint = snapshotRecoveryPoints.find(point => point.id === id)
    if (!recoveryPoint) {
      snapshotError = `Recovery point not found: ${id}`
      snapshotErrorCode = null
      return
    }

    recoveryDialogPoint = recoveryPoint
    recoveryDialogError = null
    snapshotError = null
  }

  async function confirmRecoveryPointApply() {
    if (!recoveryDialogPoint) return

    recoveryApplyingId = recoveryDialogPoint.id
    recoveryDialogError = null
    snapshotError = null

    try {
      const result = await window.api.snapshot.applyRecovery({ id: recoveryDialogPoint.id })
      recoveryApplyingId = null

      if (result.ok) {
        recoveryDialogPoint = null
        recoveryDialogError = null
        await reloadCurrentProject()
        await refreshSnapshots()
        exitCompareMode()
        workingCopyBaseSnapshot = null
        workingCopyDirty = true
        showToast('Recovered current project from recovery point')
      } else {
        recoveryDialogError = result.error.message
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      recoveryApplyingId = null
      recoveryDialogError = `Failed to apply recovery point: ${message}`
    }
  }

  function cancelRecoveryPointApply() {
    if (recoveryApplyingId) return
    recoveryDialogPoint = null
    recoveryDialogError = null
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  function getDescendantCount(nodeId: string, nodes: ManifestNode[]): number {
    let count = 0
    const queue = [nodeId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const children = nodes.filter(n => n.parentId === id)
      count += children.length
      queue.push(...children.map(c => c.id))
    }
    return count
  }
</script>

<!-- ─── Window drag region for macOS hidden titlebar ─────────────────────── -->
{#if desktopChrome.supportsWindowDragRegion}
  <div
    class="fixed top-0 left-0 right-0 h-8 [-webkit-app-region:drag] pointer-events-none z-50"
    data-testid="window-drag-region"
  ></div>
{/if}

<!-- ─── Toast ─────────────────────────────────────────────────────────────── -->
{#if toastMsg}
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-700 text-white
              text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm text-center"
       data-testid="toast">
    {toastMsg}
  </div>
{/if}


<!-- ─── Move-to dialog ────────────────────────────────────────────────────── -->
{#if duplicateNode && project}
  <DuplicateDialog node={duplicateNode} nodes={project.nodes} onConfirm={confirmDuplicate} onCancel={() => { duplicateNodeId = null }} />
{/if}

{#if batchDialogOpen && project && selectedNodes.length > 1}
  <BatchPropertyDialog
    {project}
    nodes={selectedNodes}
    onConfirm={confirmBatchPropertyUpdate}
    onCancel={() => { batchDialogOpen = false }}
  />
{/if}

{#if moveToNodeId && project}
  <MoveToDialog
    nodeId={moveToNodeId}
    nodes={project.nodes}
    onConfirm={confirmMoveTo}
    onCancel={() => { moveToNodeId = null }}
  />
{/if}

<!-- ─── Template manager ──────────────────────────────────────────────────── -->
{#if templateManagerOpen && project}
  <TemplateManager
    templates={project.templates ?? {}}
    onCreate={handleTemplateCreate}
    onUpdate={handleTemplateUpdate}
    onDelete={handleTemplateDelete}
    onClose={() => { templateManagerOpen = false }}
  />
{/if}

<!-- ─── Import dialog ─────────────────────────────────────────────────────── -->
{#if importDialogOpen && project && importBaseParent}
  <ImportDialog
    baseParent={importBaseParent}
    templates={project.templates ?? {}}
    onImported={handleImported}
    onClose={() => { importDialogOpen = false }}
  />
{/if}

<!-- ─── Welcome ────────────────────────────────────────────────────────────── -->
{#if archiveOpen}<ProjectArchive canExport={appState === 'open' && project !== null} onClose={() => { archiveOpen = false }} />{/if}
{#if appState === 'welcome'}
  <div class="flex h-full bg-stone-50">
    <div class="flex w-full max-w-4xl flex-col px-10 py-10 mx-auto">
      <header class="flex items-center justify-between border-b border-stone-200 pb-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-stone-200">
            <img src={brandMark} alt="Manifest logo" class="h-6 w-6" />
          </div>
          <div>
            <h1 class="text-lg font-semibold tracking-tight text-stone-800">Manifest</h1>
            <p class="mt-0.5 text-sm text-stone-500">Projects</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick={() => { archiveOpen = true }} class="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700" data-testid="open-archives-btn">Archives…</button>
          <button
            onclick={beginCreateProject}
            class="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 cursor-default"
            data-testid="create-project-btn"
          >
            New Project…
          </button>
          <button
            onclick={openProject}
            class="rounded-lg bg-stone-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 cursor-default"
            data-testid="open-project-btn"
          >
            Open Project…
          </button>
        </div>
      </header>

      {#if error}
        <div class="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 rounded-lg">
          {error}
        </div>
      {/if}

      <main class="pt-8">
        <h2 class="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Recent projects</h2>
        {#if recentProjects.length > 0}
          <div class="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-white" data-testid="recent-project-list">
            {#each recentProjects as recentProject, index (recentProject.path)}
              <button
                onclick={() => openRecentProject(recentProject)}
                disabled={!recentProject.exists}
                class="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:opacity-50 {index > 0 ? 'border-t border-stone-100' : ''}"
                data-testid={index === 0 ? 'reopen-last-project-btn' : 'recent-project-btn'}
              >
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-100 text-xs font-semibold text-stone-500">
                  {recentProject.name.slice(0, 1).toUpperCase()}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-stone-800">{recentProject.name}</div>
                  <div class="mt-0.5 truncate text-xs text-stone-500">{recentProject.path}</div>
                </div>
                {#if !recentProject.exists}
                  <span class="text-xs font-medium text-stone-400">Unavailable</span>
                {/if}
              </button>
            {/each}
          </div>
        {:else}
          <div class="mt-3 rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-sm text-stone-500" data-testid="empty-recent-projects">
            <p>No recent projects. Open an existing project or create a new one to get started.</p>
            <button
              onclick={openExampleProject}
              class="mt-4 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
              data-testid="open-example-project-btn"
            >
              Open Example Project
            </button>
            <p class="mt-2 text-xs text-stone-400">Explore templates and snapshot history in a reusable sample saved to your Documents folder.</p>
          </div>
        {/if}
      </main>
    </div>
  </div>

<!-- ─── Create project form ───────────────────────────────────────────────── -->
{:else if appState === 'creating'}
  <div class="flex flex-col h-full items-center justify-center bg-stone-50">
    <div class="flex flex-col gap-5 w-full max-w-sm px-6">

      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white ring-1 ring-stone-200">
          <img src={brandMark} alt="Manifest logo" class="h-7 w-7" />
        </div>
        <div>
          <h2 class="text-lg font-semibold text-stone-800">New Project</h2>
          <p class="text-sm text-stone-400 mt-0.5">A folder will be created at the chosen location.</p>
        </div>
      </div>

      {#if error}
        <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      {/if}

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-stone-600 uppercase tracking-wide" for="proj-name">
          Project Name
        </label>
        <input
          id="proj-name"
          type="text"
          bind:value={newName}
          placeholder="Lab Bench A"
          class="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm
                 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2
                 focus:ring-stone-400 focus:border-transparent selectable"
          onkeydown={(e) => e.key === 'Enter' && createProject()}
          data-testid="project-name-input"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-stone-600 uppercase tracking-wide">Location</span>
        <div class="flex gap-2">
          <div class="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm
                      text-stone-500 truncate min-w-0" data-testid="selected-path">
            {newPath || 'No folder selected'}
          </div>
          <button
            onclick={selectFolder}
            class="shrink-0 bg-white hover:bg-stone-50 text-stone-600 text-sm
                   px-3 py-2 rounded-lg border border-stone-200 transition-colors cursor-default"
            data-testid="choose-folder-btn"
          >
            Choose…
          </button>
        </div>
      </div>

      <div class="flex gap-2 pt-1">
        <button
          onclick={() => { appState = 'welcome'; error = null }}
          class="flex-1 bg-white hover:bg-stone-50 text-stone-600 text-sm font-medium
                 px-4 py-2.5 rounded-lg border border-stone-200 transition-colors cursor-default"
        >
          Cancel
        </button>
        <button
          onclick={createProject}
          disabled={!newName.trim() || !newPath || creating}
          class="flex-1 bg-stone-800 hover:bg-stone-700 disabled:bg-stone-300
                 text-white text-sm font-medium px-4 py-2.5 rounded-lg
                 transition-colors cursor-default disabled:cursor-not-allowed"
          data-testid="create-btn"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>

    </div>
  </div>

<!-- ─── Loading ───────────────────────────────────────────────────────────── -->
{:else if appState === 'loading'}
  <div class="flex h-full items-center justify-center bg-stone-50">
    <p class="text-sm text-stone-400">Opening project…</p>
  </div>

<!-- ─── Project open ──────────────────────────────────────────────────────── -->
{:else if appState === 'open' && project}
  <div class="flex flex-col h-full bg-white" data-testid="project-view">

    <!-- Titlebar -->
    <div
      class="flex items-center justify-between pr-4 py-2.5 border-b border-stone-200 bg-white
             shrink-0 {desktopChrome.reservesTrafficLightSpace ? 'pl-20 [-webkit-app-region:drag]' : 'pl-4'}"
      data-testid="project-titlebar"
    >
      <div class="flex items-center gap-3 [-webkit-app-region:no-drag]">
        <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-50 ring-1 ring-stone-200">
          <img src={brandMark} alt="Manifest logo" class="h-5 w-5" />
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Manifest</span>
          <span class="text-sm font-semibold text-stone-800">{project.name}</span>
          <span class="text-xs text-stone-400">{project.nodes.length} nodes</span>
        </div>
        <div
          class="max-w-[320px] truncate rounded-full border px-2.5 py-1 text-xs font-medium
                 {compareMode ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}"
          data-testid="project-mode-badge"
          title={projectModeLabel}
        >
          {projectModeLabel}
        </div>
      </div>
      <div class="flex items-center gap-2 [-webkit-app-region:no-drag]">
        <button onclick={() => { archiveOpen = true }} class="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600" data-testid="open-archives-btn">Archives…</button>
        <button
          onclick={() => applyUndoRedo('undo')}
          disabled={!canUndoProject || !editHistory.undoLabel}
          title={editHistory.undoLabel ? `Undo ${editHistory.undoLabel.toLowerCase()}` : 'Nothing to undo'}
          class="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
          data-testid="project-undo-btn"
        >Undo</button>
        <button
          onclick={() => applyUndoRedo('redo')}
          disabled={!canUndoProject || !editHistory.redoLabel}
          title={editHistory.redoLabel ? `Redo ${editHistory.redoLabel.toLowerCase()}` : 'Nothing to redo'}
          class="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
          data-testid="project-redo-btn"
        >Redo</button>
        <button
          onclick={toggleSnapshots}
          aria-pressed={snapshotPanelOpen ? 'true' : 'false'}
          class="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600
                 transition-colors hover:bg-stone-50 cursor-default"
          data-testid="open-snapshots-btn"
        >
          Snapshots
        </button>
        {#if compareMode && mergedTree}
          <button
            onclick={exitCompareMode}
            class="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700
                   transition-colors hover:bg-sky-100 cursor-default"
            data-testid="exit-compare-btn"
          >
            Exit Compare
          </button>
        {/if}
      </div>
    </div>

    <!-- Project-level warnings banner (non-blocking; environmental risk) -->
    {#key project.path}
      <ExternalDocumentConflict onStatus={(conflicted) => { externalDocumentConflict = conflicted }} onResolved={async (next, loadedExternal) => {
        if (loadedExternal) { resetOpenProjectUi(); applyOpenedProject(next); workingCopyDirty = true }
        else project = next
        await refreshSnapshots()
        showToast('Versions preserved in additional recovery files. Saving can continue.')
      }} />
    {/key}
    {#if showProjectWarnings}
      <div
        class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
        data-testid="project-warnings-banner"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold">
              {projectWarnings[0].title}
              <span class="font-normal text-amber-700">— local indexes may corrupt under partial sync.</span>
            </p>
            <p class="mt-1 text-amber-800">
              {projectWarnings[0].message}
            </p>
          </div>
          <button
            onclick={() => { projectWarningsDismissed = true }}
            class="shrink-0 text-amber-700 hover:text-amber-900 cursor-default"
            aria-label="Dismiss project warning"
            data-testid="dismiss-project-warning"
          >✕</button>
        </div>
      </div>
    {/if}

    <!-- Load-time warnings banner (non-blocking; values left as-on-disk) -->
    {#if showLoadWarnings}
      <div
        class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
        data-testid="load-warnings-banner"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold">
              {loadWarnings.length} data issue{loadWarnings.length === 1 ? '' : 's'} found on open
              <span class="font-normal text-amber-700">— values were left exactly as written on disk.</span>
            </p>
            <ul class="mt-1 space-y-0.5">
              {#each loadWarnings.slice(0, 5) as w (w.path)}
                <li class="truncate">
                  <span class="font-mono text-amber-700">{w.path}</span>
                  <span class="text-amber-800"> — {w.message}</span>
                </li>
              {/each}
              {#if loadWarnings.length > 5}
                <li class="text-amber-700">…and {loadWarnings.length - 5} more</li>
              {/if}
            </ul>
          </div>
          <button
            onclick={() => { loadWarningsDismissed = true }}
            class="shrink-0 text-amber-700 hover:text-amber-900 cursor-default"
            aria-label="Dismiss warnings"
            data-testid="dismiss-load-warnings"
          >✕</button>
        </div>
      </div>
    {/if}

    <!-- Post-import summary -->
    {#if showImportSummary && importSummary}
      <div
        class="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900"
        data-testid="import-summary-banner"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold">
              Imported {importSummary.created} node{importSummary.created === 1 ? '' : 's'}
              {#if importSummary.updated > 0}<span class="font-normal text-emerald-800"> · {importSummary.updated} updated</span>{/if}
              {#if importSummary.createdParents > 0}<span class="font-normal text-emerald-800"> · {importSummary.createdParents} parent{importSummary.createdParents === 1 ? '' : 's'} created</span>{/if}
              {#if importSummary.skippedCount > 0}<span class="font-normal text-emerald-800"> · {importSummary.skippedCount} skipped</span>{/if}
              {#if importSummary.warningCount > 0}<span class="font-normal text-amber-700"> · {importSummary.warningCount} warnings</span>{/if}
            </p>
            {#if importSummary.skipped.length > 0}
              <ul class="mt-1 space-y-0.5">
                {#each importSummary.skipped.slice(0, 5) as s (s.row + (s.column ?? ''))}
                  <li class="truncate text-emerald-800">row {s.row}{s.column ? ` · ${s.column}` : ''} — {s.reason}</li>
                {/each}
                {#if importSummary.skippedCount > 5}
                  <li class="text-emerald-700">…and {importSummary.skippedCount - 5} more</li>
                {/if}
              </ul>
            {/if}
          </div>
          <button
            onclick={() => { importSummaryDismissed = true }}
            class="shrink-0 text-emerald-700 hover:text-emerald-900 cursor-default"
            aria-label="Dismiss import summary"
            data-testid="dismiss-import-summary"
          >✕</button>
        </div>
      </div>
    {/if}

    <!-- Three-pane body — tree | drag | detail | drag | snapshots -->
    <div
      class="flex flex-1 overflow-hidden"
      class:cursor-col-resize={draggingHandle !== null}
      class:select-none={draggingHandle !== null}
    >

      <!-- ── Left pane: tree + search ──────────────────────────────────── -->
      <div
        style="width: {inventoryViewMode === 'table' && !compareMode ? Math.max(treeWidth, 520) : treeWidth}px"
        class="shrink-0 flex flex-col bg-stone-50 overflow-hidden"
      >

        <!-- Search bar -->
        <div class="px-3 py-2 border-b border-stone-200">
          <div class="flex gap-1.5">
            <div class="relative min-w-0 flex-1">
              <input
                bind:this={searchInputEl}
                type="text"
                value={searchQuery}
                oninput={handleSearchInput}
                onkeydown={handleSearchKeydown}
                placeholder="Search nodes…"
                class="w-full bg-white border border-stone-200 rounded-lg pl-8 pr-8 py-1.5
                       text-sm text-stone-700 placeholder-stone-300 focus:outline-none
                       focus:ring-1 focus:ring-stone-400 selectable"
                data-testid="search-input"
              />
              <svg class="absolute left-2.5 top-2 w-3.5 h-3.5 text-stone-400" fill="none" viewBox="0 0 16 16">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              {#if searchQuery}
                <button
                  class="absolute right-2.5 top-1.5 text-stone-400 hover:text-stone-600 text-xs"
                  onclick={() => { searchQuery = ''; runSearch('') }}
                  aria-label="Clear search text"
                >✕</button>
              {/if}
            </div>
            <button
              type="button"
              class="rounded-lg border px-2 py-1.5 text-xs font-medium"
              class:border-stone-700={inventoryFiltersOpen || inventoryFiltersActive}
              class:bg-stone-800={inventoryFiltersOpen || inventoryFiltersActive}
              class:text-white={inventoryFiltersOpen || inventoryFiltersActive}
              class:border-stone-200={!inventoryFiltersOpen && !inventoryFiltersActive}
              class:bg-white={!inventoryFiltersOpen && !inventoryFiltersActive}
              class:text-stone-600={!inventoryFiltersOpen && !inventoryFiltersActive}
              disabled={compareMode}
              aria-expanded={inventoryFiltersOpen}
              onclick={() => { inventoryFiltersOpen = !inventoryFiltersOpen }}
              data-testid="inventory-filter-toggle"
            >Filter{inventoryFilterCount ? ` ${inventoryFilterCount}` : ''}</button>
            <div class="flex rounded-lg border border-stone-200 bg-white p-0.5" aria-label="Inventory view">
              <button
                type="button"
                class="rounded px-1.5 py-1 text-[10px] font-medium"
                class:bg-stone-800={inventoryViewMode === 'tree'}
                class:text-white={inventoryViewMode === 'tree'}
                class:text-stone-500={inventoryViewMode !== 'tree'}
                onclick={() => { inventoryViewMode = 'tree' }}
                data-testid="inventory-view-tree"
              >Tree</button>
              <button
                type="button"
                class="rounded px-1.5 py-1 text-[10px] font-medium"
                class:bg-stone-800={inventoryViewMode === 'table'}
                class:text-white={inventoryViewMode === 'table'}
                class:text-stone-500={inventoryViewMode !== 'table'}
                disabled={compareMode}
                onclick={() => { inventoryViewMode = 'table' }}
                data-testid="inventory-view-table"
              >Table</button>
            </div>
          </div>
          {#if inventoryFiltersOpen && project && !compareMode}
            <InventoryFilterPanel
              {project}
              {selectedId}
              filters={searchFilters}
              onChange={handleInventoryFiltersChange}
            />
          {/if}
          {#if searchActive}
            <div class="mt-2 flex items-center justify-between gap-2">
              <p class="truncate text-xs text-stone-500">
                {#if searching}
                  Searching…
                {:else if searchResults.length === 0}
                  {searchQuery.trim() ? `No results for "${searchQuery}"` : 'No nodes match these filters'}
                {:else}
                  Result {searchResultIndex + 1} of {searchTotal}{searchQuery.trim() ? ` for "${searchQuery}"` : ''}
                  {#if searchResults.length < searchTotal} · {searchResults.length} loaded{/if}
                {/if}
              </p>
              {#if searchResults.length > 1}
                <span class="shrink-0 text-[10px] text-stone-400">Enter next · Shift+Enter prev</span>
              {/if}
            </div>
            {#if searchHasMore}
              <button
                class="mt-1 text-xs font-medium text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                disabled={searchLoadingMore}
                onclick={() => { void loadMoreSearchResults() }}
                data-testid="search-load-more"
              >{searchLoadingMore ? 'Loading…' : `Load more results (${searchResults.length} of ${searchTotal})`}</button>
            {/if}
          {/if}
        </div>

        <!-- Inventory tree/table -->
        <div class="flex-1 flex flex-col overflow-hidden" data-testid="tree">
          {#if inventoryViewMode === 'table' && !compareMode && project}
            <InventoryTable
              {project}
              query={searchQuery}
              filters={searchFilters}
              {selectedId}
              bind:columns={inventoryColumns}
              bind:sortColumn={inventorySortColumn}
              bind:sortDirection={inventorySortDirection}
              onSelect={(id) => setSelection(id)}
              onMessage={showToast}
            />
          {:else}
          {#if searchActive && !searching && searchResults.length === 0}
            <div class="flex-1 p-3 text-sm text-stone-400" data-testid="search-no-results">No matching nodes</div>
          {:else}
            <div class="flex-1 overflow-hidden">
              <ManifestView
                rows={flatRows}
                mode={compareMode ? 'compare' : 'browse'}
                compareContext={compareMode && mergedTree
                  ? {
                      snapshotFrom: mergedTree.fromSnapshot,
                      snapshotTo: mergedTree.toSnapshot,
                      subtreeSummaries: compareSubtreeSummaries ?? undefined,
                    }
                  : undefined}
                expandedFolds={lensExpandedFolds}
                onFoldExpand={(foldId) => {
                  const next = new Set(lensExpandedFolds)
                  if (next.has(foldId)) next.delete(foldId)
                  else next.add(foldId)
                  lensExpandedFolds = next
                }}
                {selectedId}
                {selectedIds}
                selectedScrollAlign={selectedScrollAlign}
                onSelect={handleSelect}
                onToggle={handleToggle}
                onAddChild={handleAddChild}
                onDuplicate={handleDuplicate}
                onImportHere={handleImportHere}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onRenameRequest={handleRenameRequest}
                onDelete={handleDelete}
                onMoveTo={handleMoveTo}
                editingDisabled={editingLocked}
                matchedIds={searchMatchSet}
                matchQuery={searchQuery}
                matchDetails={searchResultMap}
                searchActive={searchActive}
                onSearchShortcutInput={handleSearchShortcutInput}
                onSearchClear={clearSearch}
                onSearchCycle={cycleSearchResult}
              />
            </div>
          {/if}

          {/if}

            <!-- Inline add-child input — rendered below the tree, always visible -->
            {#if addingChildTo && inventoryViewMode === 'tree'}
              <div class="border-t border-stone-200 px-3 py-2 flex flex-col gap-1 bg-stone-50 shrink-0">
                <input
                  type="text"
                  bind:this={addChildInput}
                  bind:value={addingChildName}
                  placeholder="Node name"
                  class="w-full text-sm border border-stone-300 rounded px-2 py-1
                         focus:outline-none focus:ring-1 focus:ring-stone-400 selectable"
                  data-testid="add-child-input"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitAddChild()
                    if (e.key === 'Escape') cancelAddChild()
                  }}
                />
                {#if addingChildError}
                  <p class="text-xs text-red-600">{addingChildError}</p>
                {/if}
                {#if addChildTemplateIds.length > 0}
                  <select
                    bind:value={addingChildTemplateId}
                    class="w-full text-sm border border-stone-300 rounded px-2 py-1 bg-white
                           focus:outline-none focus:ring-1 focus:ring-stone-400"
                    data-testid="add-child-template"
                  >
                    <option value={null}>Freeform (no template)</option>
                    {#each addChildTemplateIds as id (id)}
                      <option value={id}>{templateLabel(project?.templates?.[id], id)}</option>
                    {/each}
                  </select>
                {/if}
                <div class="flex gap-1">
                  <button
                    onclick={commitAddChild}
                    class="text-xs bg-stone-800 text-white px-2 py-1 rounded cursor-default"
                    data-testid="add-child-commit"
                  >Add</button>
                  <button
                    onclick={cancelAddChild}
                    class="text-xs text-stone-500 px-2 py-1 rounded hover:bg-stone-100 cursor-default"
                  >Cancel</button>
                </div>
              </div>
            {/if}
        </div>

      </div>

      <!-- ── Drag handle: tree | detail ────────────────────────────────── -->
      <button
        type="button"
        aria-label="Resize tree panel"
        class="w-1 shrink-0 cursor-col-resize bg-stone-200 hover:bg-sky-400
               transition-colors duration-100 p-0"
        class:bg-sky-500={draggingHandle === 'tree'}
        onmousedown={(e) => startDrag('tree', e)}
      ></button>

      <!-- ── Right pane: detail ─────────────────────────────────────────── -->
      <div class="flex-1 overflow-hidden" data-testid="detail-pane">
        {#if detailProject}
          {#if selectedNodes.length > 1 && !compareMode}
            <BatchSelectionPane
              nodes={selectedNodes}
              primaryName={selectedNode?.name ?? selectedNodes[0].name}
              readOnly={editingLocked}
              onEdit={openBatchPropertyDialog}
              onClear={() => setSelection(selectedId)}
            />
          {:else}
            <DetailPane
              node={selectedNode}
              project={detailProject}
              {renameRequestId}
              readOnly={editingLocked}
              readOnlyReason={compareMode && mergedTree
                ? `Viewing ${snapshotRefLabel(mergedTree.fromSnapshot)} -> ${snapshotRefLabel(mergedTree.toSnapshot)}. Snapshots are read-only; exit compare to edit the current project.`
                : snapshotRestoringName
                  ? 'Reverting current project — editing will resume when revert finishes.'
                  : recoveryApplyingId
                    ? 'Applying recovery point — editing will resume when recovery finishes.'
                    : undefined}
              onUpdate={handleNodeUpdate}
              onPromoteField={handlePromoteField}
              onError={showToast}
            />
          {/if}
        {/if}
      </div>

      <!-- ── Snapshots panel (docked, non-blocking) ─────────────────────── -->
      {#if snapshotPanelOpen}
        <!-- Drag handle: detail | panel -->
        <button
          type="button"
          aria-label="Resize snapshots panel"
          class="w-1 shrink-0 cursor-col-resize bg-stone-200 hover:bg-sky-400
                 transition-colors duration-100 p-0"
          class:bg-sky-500={draggingHandle === 'panel'}
          onmousedown={(e) => startDrag('panel', e)}
        ></button>

        <!-- Controlled-width wrapper — SnapshotsPanel fills it with w-full -->
        <div style="width: {panelWidth}px" class="shrink-0 overflow-hidden">
          <SnapshotsPanel
            {snapshots}
            timelineEvents={snapshotTimelineEvents}
            recoveryPoints={snapshotRecoveryPoints}
            {mergedTree}
            compareLoaded={compareMode}
            loading={snapshotLoading}
            creating={snapshotCreating}
            comparing={snapshotComparing}
            restoringName={snapshotRestoringName}
            recoveringId={recoveryApplyingId}
            error={snapshotError}
            historyUnavailable={snapshotErrorCode === 'HISTORY_METADATA_UNAVAILABLE'}
            onHistoryRepaired={async (path) => {
              await refreshSnapshots()
              workingCopyBaseSnapshot = null
              workingCopyDirty = true
              showToast(path ? `History restored. Original preserved at ${path}` : 'History restored from automatic backup.')
            }}
            highlightedNodeId={selectedId}
            scopeCandidate={selectedNode && selectedNode.parentId !== null
              ? { id: selectedNode.id, name: selectedNode.name }
              : null}
            onDiffNodeSelect={handleDiffNodeSelect}
            onClose={closeSnapshots}
            onRefresh={refreshSnapshots}
            onCreate={handleSnapshotCreate}
            onCompare={handleSnapshotCompare}
            onExitCompare={exitCompareMode}
            onRestore={handleSnapshotRestore}
            onApplyRecovery={handleApplyRecovery}
            onExportReport={handleExportReport}
            onCopyReport={handleCopyReport}
          />
        </div>
      {/if}

      {#if revertDialogSnapshotName}
        <RevertDialog
          snapshotName={revertDialogSnapshotName}
          noteRequired={revertDialogNoteRequired}
          error={revertDialogError}
          reverting={snapshotRestoringName === revertDialogSnapshotName}
          onConfirm={confirmSnapshotRevert}
          onCancel={cancelSnapshotRevert}
        />
      {/if}

      {#if recoveryDialogPoint}
        <RecoveryDialog
          recoveryPoint={recoveryDialogPoint}
          applying={recoveryApplyingId === recoveryDialogPoint.id}
          error={recoveryDialogError}
          onConfirm={confirmRecoveryPointApply}
          onCancel={cancelRecoveryPointApply}
        />
      {/if}

    </div>
  </div>
{/if}
