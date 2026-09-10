# History metadata preservation

Snapshot descriptions, revert lineage, timeline events, and retained recovery
point references live in `.manifest/history.json`. Git tags alone cannot rebuild
that information. Manifest therefore preserves an existing metadata file that
cannot be read, rather than treating it as an empty history and overwriting it.

Malformed JSON, unsupported versions, invalid records, and filesystem read
errors stop snapshot creation, revert, and recovery before those operations
flush pending edits, alter Git, replace the current document, or create/prune
recovery payloads. Existing edit history remains available. Ordinary project
editing and saving remain available.

The timeline reports the affected file and explains how to proceed: restore
that file from a known-good backup, or use a Manifest version that supports its
format, then refresh. Failed refreshes clear stale timeline/recovery entries
and do not display “No snapshots yet.” Restoring valid metadata makes history
operations available again without restarting the app. Manifest does not
automatically delete, reset, or attempt to reconstruct damaged metadata.

Lists and exports that require snapshot metadata report the same problem
instead of substituting blank descriptions or implying that context is complete.
The underlying semantic comparison remains independent of timeline metadata.

A missing metadata file remains supported for legacy projects. Their snapshot
events can be synthesized from Git tags as before. An existing unreadable file
is a different condition and is never silently treated as legacy history.

## Verification

Failure tests cover malformed JSON, future versions, invalid structures and
events. They verify unchanged metadata bytes, current document and memory,
Git snapshots, undo state, and recovery payload inventory after rejected
operations. Restoration tests verify descriptions and recovery points become
usable again. Electron coverage exercises the visible error and repair flow.

## Follow-up work

This safeguard addresses metadata that is already unreadable when an operation
starts. It does not make the current document, Git commits, and history metadata
one crash-atomic transaction. Interrupted history writes, recovery retention
ordering, external modification conflicts, and a verified portable archive and
restore workflow remain separate ownership/recovery work.

The independent Claude consultation agreed with prioritizing preservation
before archives. Its recommended next increment is validated metadata backups
and an explicit in-app repair flow, followed by reconciliation of orphaned
recovery payloads. Read-only investigation with a clearly marked incomplete
metadata state should be designed alongside repair; silently dropping context
from exports is not an acceptable fallback.
