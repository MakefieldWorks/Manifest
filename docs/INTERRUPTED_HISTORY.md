# Interrupted history operations

Snapshot creation, snapshot revert, and recovery-point application now preserve
the current inventory (including unsaved edits) and readable history metadata
before changing the project. A versioned `.manifest/history-operation.json`
record is published after those copies have been flushed to disk. The record
identifies the operation and fingerprints both copies.

The record remains until the operation reports success or safely rolls back.
An uncertain failure,
process termination, or interruption after the history commit but before cleanup
therefore leaves evidence for the next session. A cleanup failure after a
successful commit still reports the operation as successful, with the remaining
evidence surfaced for review. Opening the project does not
replay Git commands or infer whether the operation completed. Editing, Undo/Redo,
saving, final save on close, new history mutations, and archive export pause
until the user reviews the unfinished operation. Read-only inspection remains
available. Derived history-index backfill is not started while evidence is pending.

## Review and continue

The banner opens a review showing the operation, start time, current and earlier
node counts, and the preserved inventory's location. Cancel changes nothing.
The preview token covers the record, both preserved copies, current inventory,
document bytes, and readable current history. A changed preview must be reviewed
again.

**Continue with current inventory** is explicit acknowledgement, not rollback or
automatic repair of lost metadata. It preserves another copy of the current
inventory and current history, saves the current inventory, clears Undo/Redo,
and clears its assumed snapshot baseline and pending-revert association. Existing
Git commits/tags and history events remain unchanged. A snapshot created before
an interruption may exist without its original note or timeline event; Manifest
does not invent those. The pending record is moved to the recovery directory,
retaining all evidence. The earlier inventory can subsequently be reviewed and
added through **Additional recovery files**, then applied through normal recovery.

If acknowledgement fails, the pending record remains for a fresh review/retry.
Unreadable history can be restored through the existing automatic-backup review;
outside document changes can be resolved through the external-change review.
Neither action clears the unfinished-operation record. Missing, altered, linked,
or unsupported evidence requires manual recovery and is never silently discarded.

Normal successful operations remove their temporary before-state copies. Copies
retained for interrupted operations are not automatically pruned. They use the
existing recovery directory and are included in portable archives once the
unfinished operation has been acknowledged.

## Boundaries

This is process-interruption detection and explicit continuation, not an atomic
transaction across Git, the document, and history. It does not automatically
complete or roll back a partially executed operation, prevent arbitrary external
writers, or guarantee directory-entry durability during sudden power loss.
Metadata-only recovery registration, backup restoration, external-document
resolution, and initial project creation are outside this journal's scope.
Existing backup and preservation protections continue to apply to those paths.

Tests inject failures before metadata persistence and during completion for all
three journaled operations, reopen the project, and verify write blocking,
preserved inventories, unchanged Git refs, stale-token rejection, retry behavior,
and malformed evidence. Electron coverage exercises the review, Cancel, explicit
continuation, and resumed editing.
