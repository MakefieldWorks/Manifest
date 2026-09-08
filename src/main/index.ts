import { app, BrowserWindow, ipcMain, dialog, shell, screen, clipboard, nativeTheme } from 'electron'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { createLogger } from './logger'
import { ProjectManager } from './project-manager'
import { GitService } from './git-service'
import { IPC, type FolderDialogPurpose } from '../shared/ipc'
import { ok, err, ErrorCode } from '../shared/errors'
import {
  installApplicationMenu,
  updateApplicationMenuRecentProjects,
  updateApplicationMenuState,
} from './app-menu'
import { resolveProjectOpenTarget } from './project-open-target'
import { collectProjectOpenTargets } from './launch-arguments'
import { openExampleProject } from './example-project'
import { isTrustedRendererNavigationUrl } from './renderer-navigation'
import { RecentProjectsStore, getRecentDocumentPath } from './recent-projects'
import {
  AppSettingsStore,
  resolveRestorableWindowBounds,
  type AppPreferencesPatch,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from './app-settings'
import { desktopChromeForPlatform } from '../shared/desktop-chrome'
import { isAppearanceMode, resolveTheme } from '../shared/theme'
import { buildDiagnostics } from './diagnostics'
import {
  ensureFinalProjectSave,
  finalSaveFailureActionForResponse,
  finalSaveFailureDialogOptions,
  type FinalSaveContext,
  type FinalSaveFailureAction,
} from './final-save'
import type { Project, Result, NodeTemplate, ImportMapping, NetboxImportOptions } from '../shared/types'
import type { ReportFormat } from '../shared/report'
import type { BatchPropertyUpdateRequest } from '../shared/batch-properties'

// ─── Logging ────────────────────────────────────────────────────────────────

const userData = app.getPath('userData')
const logDir   = join(userData, 'logs')

const appLogger     = createLogger('app',     join(logDir, 'app.log'))
const gitLogger     = createLogger('git',     join(logDir, 'git.log'))
const projectLogger = createLogger('project', join(logDir, 'project.log'))

// ─── Services ────────────────────────────────────────────────────────────────

const gitService     = new GitService(gitLogger)
const projectManager = new ProjectManager(gitService, projectLogger)
const recentProjects = new RecentProjectsStore(join(userData, 'recent-projects.json'))
const appSettings = new AppSettingsStore(join(userData, 'app-settings.json'))
const DOCUMENTATION_URL = 'https://github.com/rgehrsitz/Manifest#readme'
const REPORT_ISSUE_URL = 'https://github.com/rgehrsitz/Manifest/issues/new'
const SETTINGS_WINDOW_WIDTH = 760
const SETTINGS_WINDOW_HEIGHT = 560

// ─── Window ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
const pendingOpenTargets: string[] = []
let ownsSingleInstanceLock = false
let quitAfterFinalSave = false
let finalQuitInProgress = false
const approvedWindowCloses = new WeakSet<BrowserWindow>()
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null

function createWindow(): BrowserWindow {
  const iconPath = getBrandIconPath()
  const storedWindowState = appSettings.getWindowState()
  const restoredBounds = resolveRestorableWindowBounds(storedWindowState, screen.getAllDisplays())
  const desktopChrome = desktopChromeForPlatform(process.platform)
  const win = new BrowserWindow({
    x: restoredBounds?.x,
    y: restoredBounds?.y,
    width: restoredBounds?.width ?? 1280,
    height: restoredBounds?.height ?? 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Manifest',
    icon: iconPath,
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: desktopChrome.titleBarStyle,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (storedWindowState?.isMaximized) {
    win.maximize()
  }
  if (storedWindowState?.isFullScreen) {
    win.setFullScreen(true)
  }

  win.once('ready-to-show', () => win.show())
  configureRendererNavigation(win)
  win.on('focus', () => notifyWindowFocusChanged(win, true))
  win.on('blur', () => notifyWindowFocusChanged(win, false))
  win.webContents.on('did-finish-load', () => notifyWindowFocusChanged(win, win.isFocused()))
  win.on('move', () => scheduleWindowStateSave(win))
  win.on('resize', () => scheduleWindowStateSave(win))
  win.on('maximize', () => saveWindowState(win))
  win.on('unmaximize', () => saveWindowState(win))
  win.on('enter-full-screen', () => saveWindowState(win))
  win.on('leave-full-screen', () => saveWindowState(win))
  win.on('close', (event) => {
    saveWindowState(win)
    if (quitAfterFinalSave || approvedWindowCloses.has(win) || !projectManager.getCurrent()) return
    event.preventDefault()
    void closeWindowAfterFinalSave(win)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
  return win
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const desktopChrome = desktopChromeForPlatform(process.platform)
  const owner = mainWindow ?? BrowserWindow.getFocusedWindow()
  const position = settingsWindowPosition(owner, SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
  const win = new BrowserWindow({
    ...position,
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    minWidth: 640,
    minHeight: 480,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Manifest Settings',
    icon: getBrandIconPath(),
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: desktopChrome.titleBarStyle,
    parent: owner ?? undefined,
    modal: owner !== null,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  configureRendererNavigation(win)
  win.on('focus', () => notifyWindowFocusChanged(win, true))
  win.on('blur', () => notifyWindowFocusChanged(win, false))
  win.webContents.on('did-finish-load', () => notifyWindowFocusChanged(win, win.isFocused()))
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const settingsUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    settingsUrl.searchParams.set('settings', '1')
    void win.loadURL(settingsUrl.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { settings: '1' } })
  }

  settingsWindow = win
  return win
}

function settingsWindowPosition(
  owner: BrowserWindow | null,
  width: number,
  height: number,
): { x: number; y: number } | undefined {
  if (!owner || owner.isDestroyed()) return undefined
  const ownerBounds = owner.getBounds()
  const workArea = screen.getDisplayMatching(ownerBounds).workArea
  const gap = 24
  const rightEdge = workArea.x + workArea.width
  const bottomEdge = workArea.y + workArea.height
  const fitsRight = ownerBounds.x + ownerBounds.width + gap + width <= rightEdge
  const fitsLeft = ownerBounds.x - gap - width >= workArea.x
  const preferredX = fitsRight
    ? ownerBounds.x + ownerBounds.width + gap
    : fitsLeft
      ? ownerBounds.x - gap - width
      : ownerBounds.x + Math.round((ownerBounds.width - width) / 2)
  const preferredY = ownerBounds.y + Math.round((ownerBounds.height - height) / 2)

  return {
    x: clampWindowCoordinate(preferredX, workArea.x, rightEdge - width),
    y: clampWindowCoordinate(preferredY, workArea.y, bottomEdge - height),
  }
}

function clampWindowCoordinate(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(value, Math.max(min, max))))
}

function synchronizeNativeAppearance(): void {
  nativeTheme.themeSource = appSettings.getPreferences().appearance.mode
  updateWindowThemeBackgrounds()
}

function windowBackgroundColor(): string {
  const preference = appSettings.getPreferences().appearance
  const theme = resolveTheme(preference, nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  return theme.tokens['surface-canvas']
}

function updateWindowThemeBackgrounds(): void {
  const backgroundColor = windowBackgroundColor()
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.setBackgroundColor(backgroundColor)
  }
}

function broadcastPreferencesChanged(): void {
  const preferences = appSettings.getPreferences()
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.SETTINGS_PREFERENCES_CHANGED, preferences)
    }
  }
}

nativeTheme.on('updated', () => {
  updateWindowThemeBackgrounds()
  broadcastPreferencesChanged()
})

// ─── IPC handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {

  // ── Project lifecycle ────────────────────────────────────────────────────

  ipcMain.handle(IPC.PROJECT_CREATE, async (_, { name, parentPath }: { name: string; parentPath: string }) => {
    const result = await projectManager.createProject(name, parentPath)
    trackRecentProject(result)
    return result
  })

  ipcMain.handle(IPC.PROJECT_OPEN, async (_, { path }: { path: string }) => {
    const result = await projectManager.openProject(path)
    trackRecentProject(result)
    return result
  })

  ipcMain.handle(IPC.PROJECT_OPEN_EXAMPLE, async () => {
    const configuredDirectory = process.env['MANIFEST_EXAMPLE_PROJECTS_DIR']?.trim()
    // The example is a user-owned project, so keep it visible alongside their documents.
    const examplesDirectory = configuredDirectory || join(app.getPath('documents'), 'Manifest Examples')
    const result = await openExampleProject(projectManager, examplesDirectory)
    trackRecentProject(result)
    return result
  })

  ipcMain.handle(IPC.PROJECT_SAVE, async () =>
    projectManager.saveProject()
  )

  ipcMain.handle(IPC.PROJECT_UNDO, () => projectManager.undo())
  ipcMain.handle(IPC.PROJECT_REDO, () => projectManager.redo())
  ipcMain.handle(IPC.PROJECT_EDIT_HISTORY, () => ok(projectManager.editHistoryState()))
  ipcMain.handle(IPC.TEXT_UNDO_REDO, (event, direction: unknown) => {
    if (direction !== 'undo' && direction !== 'redo') {
      return err(ErrorCode.VALIDATION_FAILED, 'Invalid text editing command')
    }
    event.sender[direction]()
    return ok(undefined)
  })

  ipcMain.handle(IPC.PROJECT_GET_CURRENT, () => {
    const project = projectManager.getCurrent()
    return ok(project)
  })

  ipcMain.handle(IPC.PROJECT_CLOSE, async () =>
    closeProjectAfterFinalSave(mainWindow ?? BrowserWindow.getFocusedWindow())
  )

  // ── Node CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.NODE_DUPLICATE, (_, { id, name }: { id: string; name: string }) =>
    projectManager.nodeDuplicate(id, name)
  )

  ipcMain.handle(IPC.NODE_BATCH_UPDATE_PROPERTIES, (_, request: BatchPropertyUpdateRequest) =>
    projectManager.nodeBatchUpdateProperties(request)
  )

  ipcMain.handle(IPC.NODE_CREATE, (
    _,
    { parentId, name, templateId }: { parentId: string; name: string; templateId?: string | null }
  ) => projectManager.nodeCreate(parentId, name, templateId))

  ipcMain.handle(IPC.NODE_UPDATE, (
    _,
    { id, changes }: {
      id: string
      changes: {
        name?: string
        properties?: Record<string, string | number | boolean | null>
        templateId?: string | null
      }
    }
  ) => projectManager.nodeUpdate(id, changes))

  ipcMain.handle(IPC.NODE_DELETE, (
    _,
    { id, options }: { id: string; options?: { unlinkReferences?: boolean } }
  ) => projectManager.nodeDelete(id, options))

  ipcMain.handle(IPC.NODE_MOVE, (
    _,
    { id, newParentId, newOrder }: { id: string; newParentId: string; newOrder: number }
  ) => projectManager.nodeMove(id, newParentId, newOrder))

  ipcMain.handle(IPC.NODE_HISTORY, (_, { nodeId }: { nodeId: string }) =>
    projectManager.nodeHistory(nodeId)
  )

  ipcMain.handle(IPC.NODE_HISTORY_BACKFILL_STATUS, () =>
    ok(projectManager.getHistoryIndexStatus())
  )

  ipcMain.handle(IPC.NODE_HISTORY_REINDEX, () =>
    projectManager.reindexHistory()
  )

  // ── Templates ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.TEMPLATE_CREATE, (
    _,
    { id, template }: { id: string; template: NodeTemplate }
  ) => projectManager.templateCreate(id, template))

  ipcMain.handle(IPC.TEMPLATE_UPDATE, (
    _,
    { id, changes }: { id: string; changes: Partial<NodeTemplate> }
  ) => projectManager.templateUpdate(id, changes))

  ipcMain.handle(IPC.TEMPLATE_DELETE, (_, { id }: { id: string }) =>
    projectManager.templateDelete(id)
  )

  // ── CSV import ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.IMPORT_INSPECT, (_, { path }: { path: string }) =>
    projectManager.inspectImport(path)
  )

  ipcMain.handle(IPC.IMPORT_PLAN, (_, { path, mapping }: { path: string; mapping: ImportMapping }) =>
    projectManager.planImportCsv(path, mapping)
  )

  ipcMain.handle(IPC.IMPORT_APPLY, (_, { path, mapping }: { path: string; mapping: ImportMapping }) =>
    projectManager.applyImportCsv(path, mapping)
  )

  // ── NetBox import ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.IMPORT_NETBOX_INSPECT, (_, { path }: { path: string }) =>
    projectManager.inspectNetboxImport(path)
  )

  ipcMain.handle(
    IPC.IMPORT_NETBOX_PLAN,
    (_, { path, options }: { path: string; options: NetboxImportOptions }) =>
      projectManager.planNetboxImport(path, options)
  )

  ipcMain.handle(
    IPC.IMPORT_NETBOX_APPLY,
    (_, { path, options }: { path: string; options: NetboxImportOptions }) =>
      projectManager.applyNetboxImport(path, options)
  )

  // ── Search ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SEARCH_QUERY, (_, { query }: { query: string }) =>
    projectManager.searchNodes(query)
  )

  // ── Git ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GIT_CHECK, async () => {
    const status = await gitService.checkVersion()
    return ok(status)
  })

  // ── Report export ──────────────────────────────────────────────────────────
  // Main builds the content authoritatively (ProjectManager.buildReport) and owns
  // the save dialog + file write — the renderer never touches the filesystem.

  ipcMain.handle(IPC.REPORT_EXPORT, async (_, { from, to, format }: { from: string; to: string; format: ReportFormat }) => {
    const built = await projectManager.buildReport(from, to, format)
    if (!built.ok) return built
    // showSaveDialog AND writeFile are both inside the try so a dialog or write
    // rejection resolves to a Result, never throwing across the IPC boundary.
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export change report',
        defaultPath: built.data.suggestedName,
        filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Markdown', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return ok({ savedPath: null })
      await writeFile(result.filePath, built.data.content, 'utf8')
      return ok({ savedPath: result.filePath })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return err(ErrorCode.REPORT_WRITE_FAILED, `Failed to write report: ${msg}`)
    }
  })

  ipcMain.handle(IPC.REPORT_BUILD, (_, { from, to, format }: { from: string; to: string; format: ReportFormat }) =>
    projectManager.buildReport(from, to, format)
  )

  // ── Dialog helpers ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.DIALOG_OPEN_FOLDER, async (_, { title, purpose }: { title: string; purpose?: FolderDialogPurpose }) => {
    const directoryKind = directoryKindForFolderDialogPurpose(purpose)
    const result = await dialog.showOpenDialog({
      title,
      defaultPath: directoryKind ? appSettings.getLastDirectory(directoryKind) : undefined,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (!result.canceled && result.filePaths[0] && directoryKind) {
      appSettings.recordLastDirectory(directoryKind, result.filePaths[0])
    }
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (_, { title }: { title: string }) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: [
        { name: 'Importable (CSV, NetBox JSON)', extensions: ['csv', 'json'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'NetBox JSON', extensions: ['json'] },
      ],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Native menu state ────────────────────────────────────────────────────
  // Renderer-owned UI state drives native menu enablement. The renderer still
  // self-guards every command when a menu item or accelerator dispatches.
  ipcMain.on(IPC.MENU_STATE_UPDATE, (_, state: unknown) => {
    updateApplicationMenuState(state)
  })

  ipcMain.handle(IPC.WINDOW_FOCUS_GET, (event) =>
    ok(BrowserWindow.fromWebContents(event.sender)?.isFocused() ?? true)
  )

  ipcMain.handle(IPC.RECENT_PROJECTS_LIST, () =>
    ok(recentProjects.all())
  )

  ipcMain.handle(IPC.SETTINGS_GET, () =>
    ok(appSettings.getWorkspaceSettings())
  )

  ipcMain.handle(IPC.SETTINGS_UPDATE_WORKSPACE, (_, patch: unknown) =>
    ok(appSettings.updateWorkspaceSettings(normalizeWorkspaceSettingsPatch(patch)))
  )

  ipcMain.handle(IPC.SETTINGS_GET_PREFERENCES, () =>
    ok(appSettings.getPreferences())
  )

  ipcMain.handle(IPC.SETTINGS_UPDATE_PREFERENCES, (_, patch: unknown) => {
    const preferences = appSettings.updatePreferences(normalizePreferencesPatch(patch))
    synchronizeNativeAppearance()
    broadcastPreferencesChanged()
    return ok(preferences)
  })

  ipcMain.handle(IPC.SETTINGS_RESET_LAYOUT, () => {
    const settings = appSettings.resetLayout()
    resetMainWindowLayout(settings)
    return ok(settings)
  })

  ipcMain.handle(IPC.SETTINGS_CLOSE_WINDOW, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win === settingsWindow && !win.isDestroyed()) win.close()
    return ok(undefined)
  })

  // ── Snapshots ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SNAPSHOT_CREATE, (_, { name }: { name: string }) =>
    projectManager.snapshotCreate(name)
  )

  ipcMain.handle(IPC.SNAPSHOT_LIST, () =>
    projectManager.snapshotList()
  )

  ipcMain.handle(IPC.SNAPSHOT_COMPARE, (_, { a, b }: { a: string; b: string }) =>
    projectManager.snapshotCompare(a, b)
  )

  ipcMain.handle(IPC.SNAPSHOT_LOAD_COMPARE, (_, { a, b }: { a: string; b: string }) =>
    projectManager.snapshotLoadCompare(a, b)
  )

  ipcMain.handle(IPC.SNAPSHOT_REVERT, (_, request: { name: string; note?: string | null }) =>
    projectManager.snapshotRevert(request)
  )

  ipcMain.handle(IPC.SNAPSHOT_TIMELINE, () =>
    projectManager.snapshotTimeline()
  )

  ipcMain.handle(IPC.RECOVERY_APPLY, (_, request: { id: string }) =>
    projectManager.recoveryPointApply(request)
  )
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  appLogger.info('app starting', { version: app.getVersion(), platform: process.platform })
  synchronizeNativeAppearance()

  const gitStatus = await gitService.checkVersion()
  appLogger.info('git version check', { version: gitStatus.version, meetsMinimum: gitStatus.meetsMinimum })

  if (!gitStatus.available) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Git Not Found',
      message: 'Manifest requires Git to manage project history.',
      detail: getGitInstallInstructions(),
      buttons: ['OK'],
    })
    appLogger.warn('git not available — project creation disabled')
  } else if (!gitStatus.meetsMinimum) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Git Version Too Old',
      message: `Manifest requires Git ${gitStatus.minimumVersion}+`,
      detail: `Found Git ${gitStatus.version}. Some features may not work correctly. Please update Git.`,
      buttons: ['Continue Anyway', 'Quit'],
      defaultId: 0,
    })
    if (response === 1) {
      app.quit()
      return
    }
  }

  registerIpcHandlers()
  installApplicationMenu({
    platform: process.platform,
    isDev: Boolean(process.env['ELECTRON_RENDERER_URL']),
    appName: app.name || 'Manifest',
    logsPath: logDir,
    logger: appLogger,
    recentProjects: recentProjects.all(),
    openRecentProject: openRecentProject,
    clearRecentProjects: clearRecentProjects,
    openPreferences: openPreferences,
    openDocumentation: openDocumentation,
    reportIssue: reportIssue,
    copyDiagnostics: copyDiagnostics,
  })
  const iconPath = getBrandIconPath()
  configureAboutPanel(iconPath)
  if (process.platform === 'darwin' && iconPath) {
    app.dock?.setIcon(iconPath)
  }
  await drainPendingOpenTargets()
  await reopenLastProjectIfRequested()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  ownsSingleInstanceLock = true
  app.on('second-instance', (_event, argv) => {
    focusMainWindow()
    for (const target of collectOpenTargetsFromArgv(argv)) {
      void openProjectFromOsTarget(target, { notifyRenderer: true })
    }
  })
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  queueOpenTarget(path)
})

// Flush autosave before quitting so no changes are lost. Electron cannot await
// before-quit listeners, so normal quits are paused and resumed after the final
// save either succeeds or the user explicitly chooses Quit Anyway.
app.on('before-quit', (event) => {
  if (quitAfterFinalSave || !projectManager.getCurrent()) return
  event.preventDefault()
  void quitAfterFinalSavePrompt()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

for (const target of collectOpenTargetsFromArgv(process.argv)) {
  queueOpenTarget(target)
}

function getGitInstallInstructions(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Install via Xcode Command Line Tools:\n  xcode-select --install\n\nOr download from https://git-scm.com'
    case 'win32':
      return 'Download and install from https://git-scm.com/download/win'
    default:
      return 'Install via your package manager:\n  sudo apt install git\n  sudo dnf install git\n\nOr visit https://git-scm.com'
  }
}

function getBrandIconPath(): string | undefined {
  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(iconPath) ? iconPath : undefined
}

function configureAboutPanel(iconPath: string | undefined): void {
  app.setAboutPanelOptions({
    applicationName: app.name || 'Manifest',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: `Copyright © ${new Date().getFullYear()} Manifest contributors`,
    website: DOCUMENTATION_URL,
    iconPath,
  })
}

function scheduleWindowStateSave(win: BrowserWindow): void {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    saveWindowState(win)
  }, 250)
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = (win.isMaximized() || win.isFullScreen())
    ? win.getNormalBounds()
    : win.getBounds()
  appSettings.updateWindowState({
    bounds,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  })
}

async function closeProjectAfterFinalSave(owner: BrowserWindow | null): Promise<Result<void>> {
  const outcome = await runFinalSaveFlow('project-close', owner)
  if (outcome === 'proceed-anyway') {
    projectLogger.warn('project closed after final save failure')
  }
  projectManager.discardCurrentProject()
  return ok(undefined)
}

async function closeWindowAfterFinalSave(win: BrowserWindow): Promise<void> {
  const outcome = await runFinalSaveFlow('window-close', win)
  if (outcome === 'proceed-anyway') {
    projectLogger.warn('window closed after final save failure')
  }
  projectManager.discardCurrentProject()
  if (win.isDestroyed()) return
  approvedWindowCloses.add(win)
  win.close()
}

async function quitAfterFinalSavePrompt(): Promise<void> {
  if (finalQuitInProgress) return
  finalQuitInProgress = true
  const outcome = await runFinalSaveFlow('quit', mainWindow ?? BrowserWindow.getFocusedWindow())
  if (outcome === 'proceed-anyway') {
    projectLogger.warn('app quit after final save failure')
  }
  quitAfterFinalSave = true
  finalQuitInProgress = false
  app.quit()
}

async function runFinalSaveFlow(
  context: FinalSaveContext,
  owner: BrowserWindow | null,
) {
  return ensureFinalProjectSave({
    context,
    window: owner,
    hasOpenProject: () => projectManager.getCurrent() !== null,
    saveProject: async () => {
      projectManager.cancelAutosave()
      return projectManager.saveProject()
    },
    showFailurePrompt: (prompt) => showFinalSaveFailurePrompt(prompt.context, prompt.message, prompt.window ?? null),
    openLogsFolder: async () => {
      await shell.openPath(logDir)
    },
  })
}

async function showFinalSaveFailurePrompt(
  context: FinalSaveContext,
  message: string,
  owner: BrowserWindow | null,
): Promise<FinalSaveFailureAction> {
  const options = finalSaveFailureDialogOptions(context, message)
  const result = owner && !owner.isDestroyed()
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return finalSaveFailureActionForResponse(result.response)
}

function queueOpenTarget(targetPath: string): void {
  if (!ownsSingleInstanceLock) return
  if (app.isReady()) {
    void openProjectFromOsTarget(targetPath, { notifyRenderer: true })
    return
  }
  pendingOpenTargets.push(targetPath)
}

async function drainPendingOpenTargets(): Promise<void> {
  while (pendingOpenTargets.length > 0) {
    const target = pendingOpenTargets.shift()
    if (!target) continue
    const result = await openProjectFromOsTarget(target, { notifyRenderer: false })
    if (!result.ok) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Could Not Open Project',
        message: result.error.message,
        buttons: ['OK'],
      })
    }
  }
}

async function reopenLastProjectIfRequested(): Promise<void> {
  if (projectManager.getCurrent() || appSettings.getPreferences().launchBehavior !== 'reopen-last-project') return
  const lastProject = appSettings.getWorkspaceSettings().lastProject
  if (!lastProject?.exists) return

  const result = await openProjectFromOsTarget(lastProject.path, { notifyRenderer: false })
  if (!result.ok) {
    appLogger.warn('could not reopen last project', { path: lastProject.path, error: result.error.message })
  }
}

async function openProjectFromOsTarget(
  targetPath: string,
  options: { notifyRenderer: boolean }
): Promise<Result<Project>> {
  const resolved = resolveProjectOpenTarget(targetPath)
  if (!resolved.ok) {
    notifyProjectOpenFromOs(resolved, options)
    return resolved
  }

  if (projectManager.getCurrent()) {
    const saved = await projectManager.saveProject()
    if (!saved.ok) {
      const failure: Result<Project> = { ok: false, error: saved.error }
      notifyProjectOpenFromOs(failure, options)
      return failure
    }
  }

  const opened = await projectManager.openProject(resolved.data)
  trackRecentProject(opened)
  notifyProjectOpenFromOs(opened, options)
  return opened
}

function openRecentProject(projectPath: string): void {
  void openProjectFromOsTarget(projectPath, { notifyRenderer: true })
}

function clearRecentProjects(): void {
  recentProjects.clear()
  app.clearRecentDocuments()
  updateApplicationMenuRecentProjects(recentProjects.all())
}

function openPreferences(): void {
  createSettingsWindow()
}

function openDocumentation(): void {
  openExternalSafely(DOCUMENTATION_URL, 'documentation link')
}

function reportIssue(): void {
  openExternalSafely(REPORT_ISSUE_URL, 'issue report link')
}

function copyDiagnostics(): void {
  copyDiagnosticsToClipboard().catch((error: unknown) => {
    appLogger.error('failed to copy diagnostics from menu', { error: errorMessage(error) })
  })
}

async function copyDiagnosticsToClipboard(): Promise<void> {
  const diagnostics = buildDiagnostics({
    appName: app.name || 'Manifest',
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    gitStatus: await gitService.checkVersion(),
    projectPath: projectManager.getCurrent()?.path ?? null,
    logsPath: logDir,
    userDataPath: userData,
  })
  clipboard.writeText(diagnostics)

  const owner = mainWindow ?? BrowserWindow.getFocusedWindow()
  const options = {
    type: 'info' as const,
    title: 'Diagnostics Copied',
    message: 'Diagnostics copied to the clipboard.',
    detail: diagnostics,
    buttons: ['OK'],
  }
  await showMessageBoxSafely('diagnostics copied dialog', owner, options)
}

function openExternalSafely(url: string, label: string): void {
  shell.openExternal(url).catch((error: unknown) => {
    appLogger.error(`failed to open ${label}`, { error: errorMessage(error), url })
  })
}

function configureRendererNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      openExternalSafely(url, 'external renderer link')
    } else {
      appLogger.warn('blocked unsafe renderer window request', { url })
    }
    return { action: 'deny' }
  })

  const blockUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    appLogger.warn('blocked renderer navigation', { url })
  }
  win.webContents.on('will-navigate', blockUntrustedNavigation)
  win.webContents.on('will-redirect', blockUntrustedNavigation)
}

function notifyWindowFocusChanged(win: BrowserWindow, isFocused: boolean): void {
  if (win.isDestroyed()) return
  win.webContents.send(IPC.WINDOW_FOCUS_CHANGED, isFocused)
}

function isTrustedRendererUrl(url: string): boolean {
  return isTrustedRendererNavigationUrl(url, {
    devServerUrl: process.env['ELECTRON_RENDERER_URL'],
    rendererDirectory: join(__dirname, '../renderer'),
  })
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

async function showMessageBoxSafely(
  label: string,
  owner: BrowserWindow | null,
  options: Electron.MessageBoxOptions,
): Promise<void> {
  if (owner && !owner.isDestroyed()) {
    await dialog.showMessageBox(owner, options).catch((error: unknown) => {
      appLogger.error(`failed to show ${label}`, { error: errorMessage(error) })
    })
  } else {
    await dialog.showMessageBox(options).catch((error: unknown) => {
      appLogger.error(`failed to show ${label}`, { error: errorMessage(error) })
    })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function trackRecentProject(result: Result<Project>): void {
  if (!result.ok) return
  if (typeof result.data.path !== 'string' || result.data.path.trim() === '') return
  appSettings.recordLastProject(result.data)
  recentProjects.add(result.data)
  const documentPath = getRecentDocumentPath(result.data.path)
  if (documentPath) app.addRecentDocument(documentPath)
  updateApplicationMenuRecentProjects(recentProjects.all())
}

function directoryKindForFolderDialogPurpose(purpose: FolderDialogPurpose | undefined): 'open' | 'create' | null {
  if (purpose === 'open-project') return 'open'
  if (purpose === 'create-project') return 'create'
  return null
}

function normalizeWorkspaceSettingsPatch(input: unknown): WorkspaceSettingsPatch {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const patch: WorkspaceSettingsPatch = {}
  if (typeof source.treeWidth === 'number') patch.treeWidth = source.treeWidth
  if (typeof source.panelWidth === 'number') patch.panelWidth = source.panelWidth
  if (source.lastOpenDirectory === null || typeof source.lastOpenDirectory === 'string') {
    patch.lastOpenDirectory = source.lastOpenDirectory
  }
  if (source.lastCreateDirectory === null || typeof source.lastCreateDirectory === 'string') {
    patch.lastCreateDirectory = source.lastCreateDirectory
  }
  return patch
}

function normalizePreferencesPatch(input: unknown): AppPreferencesPatch {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const patch: AppPreferencesPatch = {}
  if (source.launchBehavior === 'project-hub' || source.launchBehavior === 'reopen-last-project') {
    patch.launchBehavior = source.launchBehavior
  }
  if (source.appearance && typeof source.appearance === 'object') {
    const appearance = source.appearance as Record<string, unknown>
    const appearancePatch: NonNullable<AppPreferencesPatch['appearance']> = {}
    if (isAppearanceMode(appearance.mode)) appearancePatch.mode = appearance.mode
    if (typeof appearance.lightThemeId === 'string') appearancePatch.lightThemeId = appearance.lightThemeId
    if (typeof appearance.darkThemeId === 'string') appearancePatch.darkThemeId = appearance.darkThemeId
    if (Object.keys(appearancePatch).length > 0) patch.appearance = appearancePatch
  }
  return patch
}

function resetMainWindowLayout(settings: WorkspaceSettings): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  win.setSize(1280, 800)
  win.center()
  win.webContents.send(IPC.SETTINGS_LAYOUT_RESET, settings)
}

function notifyProjectOpenFromOs(
  result: Result<Project>,
  options: { notifyRenderer: boolean }
): void {
  if (!options.notifyRenderer) return
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) {
    if (!result.ok) {
      void dialog.showMessageBox({
        type: 'error',
        title: 'Could Not Open Project',
        message: result.error.message,
        buttons: ['OK'],
      })
    }
    return
  }
  if (!result.ok) {
    void dialog.showMessageBox(win, {
      type: 'error',
      title: 'Could Not Open Project',
      message: result.error.message,
      buttons: ['OK'],
    })
  }
  win.webContents.send(IPC.PROJECT_OPENED_FROM_OS, result)
  if (result.ok) focusMainWindow()
}

function focusMainWindow(): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function collectOpenTargetsFromArgv(argv: string[]): string[] {
  return collectProjectOpenTargets(argv, {
    defaultApp: process.defaultApp === true,
    appPath: app.getAppPath(),
  })
}
