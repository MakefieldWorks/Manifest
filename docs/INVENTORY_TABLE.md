# Inventory Table

The **Tree/Table** switch changes how the current inventory set is presented. The table uses the same text query and structured filters as the tree, and reports the authoritative total before loading rows in pages.

The default columns are Name, Path, and Template. Add any property key found in the project or its templates, up to twelve displayed columns. Click a column heading to sort the complete matching set in ascending or descending natural order. Empty values appear as a dash in the UI and as empty cells in CSV.

Selecting a row updates the same primary node selection used by the tree and detail pane. Switching views keeps that node selected.

**Export CSV** writes every matching row in the current sort order, including the configured columns. Export is built in the main process from the current project and filter request, so it is not limited to the rows already loaded in the renderer. Spreadsheet formula leaders are escaped by the shared CSV serializer.

Column choices, sort order, filters, and view mode are session controls. Saved views are future roadmap work.
