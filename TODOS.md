# TODOS

## Completed

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
