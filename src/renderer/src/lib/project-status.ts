// Status text and edit locks for the open project window. Pure functions over
// a few App.svelte state values so the wording and lock precedence can be
// unit tested.

import { snapshotRefLabel } from '../../../shared/snapshot-ref'

export interface CompareLabels {
  fromSnapshot: string
  toSnapshot: string
}

/** Text for the titlebar badge: compare pair, snapshot match, or dirty state. */
export function formatProjectMode(
  compare: CompareLabels | null,
  workingCopyBaseSnapshot: string | null,
  workingCopyDirty: boolean,
): string {
  if (compare) {
    return `Comparing ${snapshotRefLabel(compare.fromSnapshot)} -> ${snapshotRefLabel(compare.toSnapshot)}`
  }
  if (workingCopyBaseSnapshot) {
    return workingCopyDirty ? 'Unsnapshotted changes' : `Current project matches ${workingCopyBaseSnapshot}`
  }
  return workingCopyDirty ? 'Unsnapshotted changes' : 'Current Project'
}

export interface EditLockState {
  interruptedHistory: boolean
  externalDocumentConflict: boolean
  undoRedoBusy: boolean
  snapshotCreating: boolean
  compareMode: boolean
  snapshotRestoringName: string | null
  recoveryApplyingId: string | null
}

// Tree edits are locked while comparing, reverting, or applying a recovery point.
// Each of those operations mutates currentProject in main; interleaving a renderer
// mutation can leave the project in a half-restored state.
export function isEditingLocked(lock: EditLockState): boolean {
  return lock.interruptedHistory || lock.externalDocumentConflict || lock.undoRedoBusy || lock.snapshotCreating ||
    lock.compareMode || lock.snapshotRestoringName !== null || lock.recoveryApplyingId !== null
}

/**
 * The toast shown when an edit is refused. Undo/redo and snapshot creation
 * lock edits without a reason, and an empty toast message shows nothing.
 */
export function editLockReason(lock: EditLockState): string {
  if (lock.interruptedHistory) return 'Review the unfinished history operation before editing.'
  if (lock.externalDocumentConflict) return 'Resolve the external project change before editing.'
  if (lock.compareMode) return 'Exit compare to edit the current project.'
  if (lock.snapshotRestoringName) return 'Wait for revert to finish before editing.'
  if (lock.recoveryApplyingId) return 'Wait for recovery to finish before editing.'
  return ''
}

/** The banner the detail pane shows while it is read-only, if any. */
export function detailReadOnlyReason(
  compare: CompareLabels | null,
  snapshotRestoringName: string | null,
  recoveryApplyingId: string | null,
): string | undefined {
  if (compare) {
    return `Viewing ${snapshotRefLabel(compare.fromSnapshot)} -> ${snapshotRefLabel(compare.toSnapshot)}. Snapshots are read-only; exit compare to edit the current project.`
  }
  if (snapshotRestoringName) return 'Reverting current project — editing will resume when revert finishes.'
  if (recoveryApplyingId) return 'Applying recovery point — editing will resume when recovery finishes.'
  return undefined
}
