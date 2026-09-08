# Batch property editing

Manifest can set, add, or clear one property across an explicit selection of two or more live nodes. Cmd/Ctrl-click toggles individual visible nodes and Shift-click selects the visible range from the primary selection.

The detail pane lists the exact selected nodes. The edit dialog shows when current values are mixed and previews every node whose stored value will change, including its before and after value. Nodes that already have the requested value remain untouched and are excluded from the affected count.

Template fields retain their normal coercion and validation. If selected templates define the same key with different types, that property cannot be edited as a batch. Enum editing offers only options accepted by every selected template. Reference targets must exist and cannot point a node to itself. A new key is added as a freeform property.

The main process validates the complete request before changing any node. One invalid target rejects the whole operation, so a batch never applies partially. A successful batch creates one project-history entry; Undo and Redo restore the full selected set together. Closing the project clears both the selection and session edit history as usual.

Selection applies to currently visible tree rows. Entering snapshot comparison returns to a single inspected node because comparisons are read-only. Single-node commands such as rename, duplicate, move, and delete are disabled while multiple nodes remain selected.
