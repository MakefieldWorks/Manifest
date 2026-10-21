// Pane width limits shared by the renderer (drag clamping) and main (settings
// normalization), so a width the renderer allows is never rejected on save.

export interface PaneWidthLimits {
  default: number
  min: number
  max: number
}

export const PANE_WIDTH_LIMITS = {
  // Left pane in Tree view.
  tree: { default: 288, min: 160, max: 520 },
  // Left pane in Table view. Its minimum is wide enough for the default
  // columns; it is stored separately so widening the table doesn't widen the
  // tree when switching back.
  table: { default: 520, min: 520, max: 960 },
  // Docked snapshots panel on the right.
  panel: { default: 320, min: 240, max: 600 },
} as const satisfies Record<string, PaneWidthLimits>

export type PaneHandle = keyof typeof PANE_WIDTH_LIMITS

export function clampPaneWidth(pane: PaneHandle, width: number): number {
  const { min, max } = PANE_WIDTH_LIMITS[pane]
  return Math.max(min, Math.min(max, width))
}
