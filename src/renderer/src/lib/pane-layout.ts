// Resizable pane widths for the project window and how they are persisted.

export const DEFAULT_TREE_WIDTH = 288   // 18rem
export const DEFAULT_PANEL_WIDTH = 320  // 20rem
export const WORKSPACE_SETTINGS_SAVE_DELAY_MS = 250

/** The table view needs more room than the tree, so it widens the left pane. */
export const TABLE_MIN_TREE_WIDTH = 520

export type PaneHandle = 'tree' | 'panel'

/**
 * Width after dragging a handle by `delta` px from where the drag started.
 * The snapshots panel's handle is on its left edge, so dragging left grows it.
 */
export function dragPaneWidth(handle: PaneHandle, startWidth: number, delta: number): number {
  if (handle === 'tree') return Math.max(160, Math.min(520, startWidth + delta))
  return Math.max(240, Math.min(600, startWidth - delta))
}

/**
 * The persisted form of the pane widths, rounded to whole pixels. App compares
 * these strings to skip saving when nothing changed.
 */
export function serializeWorkspacePaneSettings(treeWidth: number, panelWidth: number): string {
  return JSON.stringify({
    treeWidth: Math.round(treeWidth),
    panelWidth: Math.round(panelWidth),
  })
}
