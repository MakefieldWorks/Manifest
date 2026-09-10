# TODOS

## Completed

- Portable project archives with current inventory, Git snapshots, history/recovery sidecars, verified export and restore to a separate folder, stale-review protection, and rebuilt indexes. **Implemented:** 2026-09-10

- Review and explicitly register unlisted recovery files, with validation, stale-preview protection, truthful unknown provenance, separate recovery confirmation, and retention outside the automatic ten-point limit. **Implemented:** 2026-09-10

- Validated automatic history metadata backup and explicit in-app restore preview, with original-byte preservation, stale-preview rejection, missing-primary protection, and backup-aware recovery-file pruning. **Implemented:** 2026-09-10
- Preserve unreadable history metadata and block snapshot/revert/recovery mutations before side effects; show restoration guidance and resume after a valid file is restored. **Implemented:** 2026-09-09
- Self-contained HTML comparison reviews with complete prioritized findings, severity/classification context, scoped changes, snapshot descriptions, escaped user content, and offline browser/print support. **Implemented:** 2026-09-09
- Scoped comparison for a selected room, rack, device, or other subtree, with backend-enforced node and relevant schema filtering plus scope-aware Markdown/CSV reports. **Implemented:** 2026-09-09
- Optional snapshot descriptions with a 2,000-character limit, preserved as immutable timeline context and shown in timeline, compare, node history, Markdown reports, and CSV exports. **Implemented:** 2026-09-09
- Sortable inventory table with configurable property columns, complete filtered paging, shared tree selection, and CSV export of the same authoritative result set. **Implemented:** 2026-09-09
- Structured inventory filters for subtree, template, property equals/contains, and missing required values, composable with complete paged text search. **Implemented:** 2026-09-08
- Truthful inventory search totals and incremental loading beyond the initial 50 matches, with stable paging and visible loaded-versus-total status. **Implemented:** 2026-09-08
- Multi-select and atomic batch property editing with mixed-value handling, an exact affected-node preview, validation across the full selection, and one-step Undo/Redo. **Implemented:** 2026-09-08
- Duplicate nodes/subtrees beside their source with name validation, shared templates, remapped internal references, and one-step Undo/Redo. **Implemented:** 2026-09-08
- Project-level Undo/Redo for node edits, template changes, and CSV/NetBox imports, with native text undo kept separate. Session and snapshot boundaries are documented in `docs/UNDO_REDO.md`. **Implemented:** 2026-09-08
- Unified search-in-tree: the visible search box filters the hierarchy to matching nodes plus ancestors, highlights matches in-tree, shows property-match snippets inline, and uses Enter/Shift+Enter/Escape for cycling and clearing. Typing while the tree is focused feeds the same search box instead of opening a hidden mode. **Updated:** 2026-06-22
- Reference properties: add a force-delete / unlink workflow for mutual references across different subtrees. The delete guard now reports every incoming reference (live node references and stale template reference defaults) as a `ReferenceBlocker[]` in the error context, and `node.delete(id, { unlinkReferences: true })` force-deletes by nulling the blocking references on survivors and clearing stale template defaults, then re-indexing search. The renderer shows a confirm dialog listing the blockers before forcing. **Completed:** 2026-06-20 (ee99b61)
