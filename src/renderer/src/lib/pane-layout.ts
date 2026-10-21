// Resizable pane widths for the project window and how they are persisted.
// The limits themselves live in shared/pane-layout so main clamps saved
// settings to the same ranges.

import { clampPaneWidth, PANE_WIDTH_LIMITS, type PaneHandle } from '../../../shared/pane-layout'

export type { PaneHandle }

export const DEFAULT_TREE_WIDTH = PANE_WIDTH_LIMITS.tree.default
export const DEFAULT_TABLE_WIDTH = PANE_WIDTH_LIMITS.table.default
export const DEFAULT_PANEL_WIDTH = PANE_WIDTH_LIMITS.panel.default
export const WORKSPACE_SETTINGS_SAVE_DELAY_MS = 250

/**
 * Width after dragging a handle by `delta` px from where the drag started.
 * The snapshots panel's handle is on its left edge, so dragging left grows it.
 */
export function dragPaneWidth(handle: PaneHandle, startWidth: number, delta: number): number {
  return clampPaneWidth(handle, handle === 'panel' ? startWidth - delta : startWidth + delta)
}

export interface PaneWidths {
  treeWidth: number
  tableWidth: number
  panelWidth: number
}

/**
 * The persisted form of the pane widths, rounded to whole pixels. App compares
 * these strings to skip saving when nothing changed.
 */
export function serializeWorkspacePaneSettings(widths: PaneWidths): string {
  return JSON.stringify(roundPaneWidths(widths))
}

export function roundPaneWidths(widths: PaneWidths): PaneWidths {
  return {
    treeWidth: Math.round(widths.treeWidth),
    tableWidth: Math.round(widths.tableWidth),
    panelWidth: Math.round(widths.panelWidth),
  }
}
