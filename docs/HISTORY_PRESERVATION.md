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

The timeline reports the affected file and offers a review of the automatic
backup. Users can also restore a known-good file manually, or use a Manifest
version that supports its format. Failed refreshes clear stale timeline/recovery entries
and do not display “No snapshots yet.” Restoring valid metadata makes history
operations available again without restarting the app. Manifest does not
automatically delete or reset damaged metadata.

Lists and exports that require snapshot metadata report the same problem
instead of substituting blank descriptions or implying that context is complete.
The underlying semantic comparison remains independent of timeline metadata.

A missing metadata file without an automatic backup remains supported for legacy projects. Their snapshot
events can be synthesized from Git tags as before. An existing unreadable file
is a different condition and is never silently treated as legacy history.

## Automatic backup and explicit restore

`.manifest/history.backup.json` holds one validated metadata copy, with its
project ID and save time. Existing readable metadata is backed up before a
history operation starts. If that backup cannot be written, the operation is
blocked before changing the project. After a successful history-operation metadata write,
the backup is refreshed to match it. First-time projects receive their first
backup when their first metadata write succeeds.

If refresh fails after the primary write, the completed operation remains a
success; the previous backup and its referenced recovery files are retained and
the failure is logged locally. Physical pruning only follows successful writes
of both primary metadata and the latest backup. Extra retained files are not
automatically reconciled or deleted by repair.

When the primary file is damaged or missing, choose **Review automatic backup**
in the snapshots panel. The preview shows the save time, counts, snapshots
absent from the backed-up timeline, and unlisted recovery files. **Restore this
backup** is a separate confirmation. Cancel leaves all files unchanged.

Restore validates the backup format, project identity, referenced Git snapshots,
and retained recovery payloads. Unsupported newer primary formats, healthy
primary metadata, and unusable backups cannot be replaced through this flow.
The preview fingerprint covers both metadata files, Git snapshot hashes, and
the recovery files; changes require a fresh preview.

Before replacement, the original bytes are copied and flushed to a unique
`history.json.damaged-*` file. If the original is missing, there is no file to
preserve. Restore leaves the current document, in-memory inventory, Undo/Redo,
Git snapshots, and recovery payloads unchanged. It clears current baseline and
pending revert lineage because a restored backup cannot establish the current
inventory's provenance. Snapshot events missing from the backup are reconstructed
from Git timestamps, with second-resolution ties placed after recorded events;
missing descriptions and exact event ordering cannot be recovered. Unlisted
recovery payloads stay on disk and are explicitly reported as outside the backup.

Restore intentionally retains the source backup unchanged, including its original
save time and lineage. The next history operation backs up the restored primary
before making changes. Preserved `history.json.damaged-*` files have no automatic
expiry; users may remove them manually after verifying recovery and retaining
any copies they need.

Metadata publication uses a flushed unique temporary file and rename. This is
one local metadata backup, not a project archive, versioned backup history, or a
transaction spanning Git, the inventory document, and all sidecars.
The containing directory is not fsynced, so a sudden power loss can still lose
the rename; file flushing alone does not guarantee crash durability.

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
before archives. Validated metadata backups and explicit restore are now
implemented; reconciliation of orphaned recovery payloads remains next.
Read-only investigation with a clearly marked incomplete
metadata state should be designed alongside repair; silently dropping context
from exports is not an acceptable fallback.

Repair diagnostics should identify the offending record and field rather than
only the record category. When the first nested schema migration is added,
deep-clone its input and test that nested caller-owned records remain unchanged;
the current migration has no nested mutating steps.
