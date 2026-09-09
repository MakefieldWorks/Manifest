# Scoped Comparison

Manifest comparisons normally review the whole project. When a room, rack,
device, or other non-root node is selected, the Compare controls also offer a
Selected subtree option.

The scope contains the selected node and the union of its descendants in both
project states. Taking the union is necessary because a node may have been
added, removed, or moved across the subtree boundary between snapshots.

Scope filtering happens in the main process after the authoritative semantic
diff is built. The renderer receives only scoped node changes, and Markdown and
CSV reports rebuild the same scoped comparison rather than filtering a
whole-project report locally. Relevant template changes are limited to templates
used by nodes inside the scope.

The comparison header displays the resolved scope path. Markdown reports include
a Scope header, CSV reports include a `scope` column on every row, and scoped
report filenames include the selected node name. Snapshot descriptions remain
present alongside the scope.

Scoped comparison narrows the review surface. It does not claim that changes
inside the selected subtree caused an observed result.
