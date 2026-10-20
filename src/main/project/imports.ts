// CSV and NetBox import: read the source file (size-capped), run the shared
// planner, and turn its output into a preview or a ProjectMutation. Each
// apply re-plans from the file (authoritative) and creates everything in ONE
// mutation, so an import is a single undoable edit.

import { readFileSync, statSync } from 'fs'
import { v7 as uuidv7 } from 'uuid'
import type {
  ImportInspect,
  ImportMapping,
  ImportPlan,
  ImportResult,
  ManifestNode,
  NetboxImportOptions,
  NetboxImportPlan,
  NetboxImportResult,
  NetboxInspect,
  Project,
  Result,
} from '../../shared/types'
import { ok, err, ErrorCode } from '../../shared/errors'
import { parseCsv, CsvParseError } from '../../shared/csv'
import { planImport, type PlannedNode } from '../../shared/import'
import { parseNetboxDump, inspectNetbox, planNetbox, NetboxParseError } from '../../shared/netbox'
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from './document'
import type { ProjectMutation } from './mutation'

const IMPORT_ISSUE_CAP = 100                   // max skipped/warning issues surfaced

// Enforce the shared import-file size cap. `label` names the file kind in the
// error message; the limit text is derived from the constant so it can't drift.
function checkImportFileSize(path: string, label: string): Result<void> {
  const stat = statSync(path)
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    const mb = Math.round(stat.size / 1024 / 1024)
    return err(ErrorCode.FILE_TOO_LARGE, `${label} is ${mb}MB (limit: ${MAX_FILE_SIZE_MB}MB)`)
  }
  return ok(undefined)
}

// Per-parent order counters seeded from existing child counts, so appended
// nodes land after their existing siblings.
function childCountsByParent(nodes: ManifestNode[]): Map<string, number> {
  const orderByParent = new Map<string, number>()
  for (const n of nodes) {
    if (n.parentId !== null) orderByParent.set(n.parentId, (orderByParent.get(n.parentId) ?? 0) + 1)
  }
  return orderByParent
}

// Planned nodes may carry a synthetic `localId` (auto-created ancestors,
// NetBox containers); map it to the real id so dependent nodes (pushed after
// their parent) wire up correctly.
function materializePlannedNodes(
  planned: PlannedNode[],
  existing: ManifestNode[],
  now: string,
): ManifestNode[] {
  const orderByParent = childCountsByParent(existing)
  const idMap = new Map<string, string>()
  return planned.map(p => {
    const parentId = idMap.get(p.parentId) ?? p.parentId
    const id = uuidv7()
    if (p.localId) idMap.set(p.localId, id)
    const order = orderByParent.get(parentId) ?? 0
    orderByParent.set(parentId, order + 1)
    return {
      id,
      parentId,
      name: p.name,
      order,
      properties: p.properties,
      ...(p.templateId ? { templateId: p.templateId } : {}),
      created: now,
      modified: now,
    }
  })
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

// Read + parse a CSV file into rows, with the same size cap as project files.
function readCsv(path: string): Result<string[][]> {
  try {
    const sizeCheck = checkImportFileSize(path, 'CSV')
    if (!sizeCheck.ok) return sizeCheck as Result<string[][]>
    const raw = readFileSync(path, 'utf8')
    return ok(parseCsv(raw))
  } catch (e: unknown) {
    if (e instanceof CsvParseError) return err(ErrorCode.VALIDATION_FAILED, e.message)
    const msg = e instanceof Error ? e.message : String(e)
    return err(ErrorCode.VALIDATION_FAILED, `Could not read CSV: ${msg}`)
  }
}

// First look at a file before any mapping: headers, a sample, total row count.
export function inspectCsvImport(path: string): Result<ImportInspect> {
  const parsed = readCsv(path)
  if (!parsed.ok) return parsed as Result<ImportInspect>
  const table = parsed.data
  const headers = table[0] ?? []
  const dataRows = table.slice(1)
  return ok({ headers, sampleRows: dataRows.slice(0, 50), rowCount: dataRows.length })
}

// Full-file validation given a mapping (counts + capped issue samples).
export function previewCsvImport(project: Project, path: string, mapping: ImportMapping): Result<ImportPlan> {
  const parsed = readCsv(path)
  if (!parsed.ok) return parsed as Result<ImportPlan>
  const table = parsed.data
  const out = planImport(
    table.slice(1), table[0] ?? [], mapping,
    project.templates ?? {}, project.nodes,
  )
  if (out.mappingError) return err(ErrorCode.VALIDATION_FAILED, out.mappingError)
  const CAP = IMPORT_ISSUE_CAP
  const createdParents = out.create.filter(n => n.auto).length
  return ok({
    acceptedCount: out.create.length - createdParents,
    updatedCount: out.update.length,
    skippedCount: out.skipped.length,
    warningCount: out.warnings.length,
    createdParents,
    skipped: out.skipped.slice(0, CAP),
    warnings: out.warnings.slice(0, CAP),
    capped: out.skipped.length > CAP || out.warnings.length > CAP,
    ...(out.suggestedNameColumn ? { suggestedNameColumn: out.suggestedNameColumn } : {}),
  })
}

// Apply: re-plan (authoritative), build every accepted node, and describe the
// result as one mutation. A null mutation means nothing to create or update.
export function planCsvImport(
  project: Project,
  path: string,
  mapping: ImportMapping,
): Result<{ mutation: ProjectMutation | null; summary: ImportResult }> {
  const parsed = readCsv(path)
  if (!parsed.ok) return parsed as Result<{ mutation: ProjectMutation | null; summary: ImportResult }>
  const table = parsed.data
  const out = planImport(
    table.slice(1), table[0] ?? [], mapping,
    project.templates ?? {}, project.nodes,
  )
  if (out.mappingError) return err(ErrorCode.VALIDATION_FAILED, out.mappingError)

  const createdParents = out.create.filter(n => n.auto).length
  const CAP = IMPORT_ISSUE_CAP
  const summary: ImportResult = {
    created: out.create.length - createdParents,
    updated: out.update.length,
    createdParents,
    skippedCount: out.skipped.length,
    warningCount: out.warnings.length,
    skipped: out.skipped.slice(0, CAP),
    warnings: out.warnings.slice(0, CAP),
    capped: out.skipped.length > CAP || out.warnings.length > CAP,
  }
  if (out.create.length === 0 && out.update.length === 0) {
    return ok({ mutation: null, summary })
  }

  const now = new Date().toISOString()
  const newNodes = materializePlannedNodes(out.create, project.nodes, now)

  // Apply update-on-key changes to existing nodes (name / properties / binding;
  // `templateId` omitted ⇒ leave the existing binding). The planner already
  // validated rebinds against the new template, so no invalid node is committed.
  const updateById = new Map(out.update.map(u => [u.nodeId, u]))
  const updatedNodeList: ManifestNode[] = []
  const updatedNodes: ManifestNode[] = project.nodes.map(n => {
    const u = updateById.get(n.id)
    if (!u) return n
    const updated: ManifestNode = {
      ...n,
      name: u.name,
      properties: u.properties,
      ...(u.templateId !== undefined ? { templateId: u.templateId } : {}),
      modified: now,
    }
    updatedNodeList.push(updated)
    return updated
  })

  const next: Project = {
    ...project,
    modified: now,
    nodes: [...updatedNodes, ...newNodes],
  }
  // Incrementally upsert only the created + updated nodes (imports never delete)
  // instead of rebuilding the whole index — keeps import cost O(import size),
  // not O(tree size). If a sync throws, commitProjectMutation falls back to a
  // full rebuild via restoreSearchIndex.
  return ok({
    mutation: { next, label: 'Import CSV', search: { upsert: [...newNodes, ...updatedNodeList] } },
    summary,
  })
}

// ─── NetBox relational import ────────────────────────────────────────────────
// NetBox is a relational DCIM source (Django dumpdata JSON). Unlike CSV, the
// adapter resolves FK relations into a Site → Location → Rack → Device tree
// with typed attributes (see src/shared/netbox.ts). inspect/plan/apply mirror
// the CSV trio; apply creates templates + nodes in ONE commit.

function readNetbox(path: string): Result<ReturnType<typeof parseNetboxDump>> {
  try {
    const sizeCheck = checkImportFileSize(path, 'NetBox export')
    if (!sizeCheck.ok) return sizeCheck as Result<ReturnType<typeof parseNetboxDump>>
    const raw = readFileSync(path, 'utf8')
    return ok(parseNetboxDump(raw))
  } catch (e: unknown) {
    if (e instanceof NetboxParseError) return err(ErrorCode.VALIDATION_FAILED, e.message)
    const msg = e instanceof Error ? e.message : String(e)
    return err(ErrorCode.VALIDATION_FAILED, `Could not read NetBox export: ${msg}`)
  }
}

export function inspectNetboxImport(path: string): Result<NetboxInspect> {
  const parsed = readNetbox(path)
  if (!parsed.ok) return parsed as Result<NetboxInspect>
  return ok(inspectNetbox(parsed.data))
}

export function previewNetboxImport(project: Project, path: string, options: NetboxImportOptions): Result<NetboxImportPlan> {
  const parsed = readNetbox(path)
  if (!parsed.ok) return parsed as Result<NetboxImportPlan>
  const out = planNetbox(
    parsed.data, options.baseParentId,
    project.templates ?? {}, project.nodes,
  )
  if (out.mappingError) return err(ErrorCode.VALIDATION_FAILED, out.mappingError)
  const CAP = IMPORT_ISSUE_CAP
  return ok({
    templatesCreated: Object.keys(out.templates).length,
    sites: out.counts.sites,
    locations: out.counts.locations,
    racks: out.counts.racks,
    devices: out.counts.devices,
    acceptedCount: out.create.length,
    skippedCount: out.skipped.length,
    warningCount: out.warnings.length,
    skipped: out.skipped.slice(0, CAP),
    warnings: out.warnings.slice(0, CAP),
    capped: out.skipped.length > CAP || out.warnings.length > CAP,
  })
}

export function planNetboxImport(
  project: Project,
  path: string,
  options: NetboxImportOptions,
): Result<{ mutation: ProjectMutation | null; summary: NetboxImportResult }> {
  const parsed = readNetbox(path)
  if (!parsed.ok) return parsed as Result<{ mutation: ProjectMutation | null; summary: NetboxImportResult }>
  const out = planNetbox(
    parsed.data, options.baseParentId,
    project.templates ?? {}, project.nodes,
  )
  if (out.mappingError) {
    return err(ErrorCode.VALIDATION_FAILED, out.mappingError)
  }
  const CAP = IMPORT_ISSUE_CAP
  const summary: NetboxImportResult = {
    templatesCreated: Object.keys(out.templates).length,
    created: out.create.length,
    sites: out.counts.sites,
    locations: out.counts.locations,
    racks: out.counts.racks,
    devices: out.counts.devices,
    skippedCount: out.skipped.length,
    warningCount: out.warnings.length,
    skipped: out.skipped.slice(0, CAP),
    warnings: out.warnings.slice(0, CAP),
    capped: out.skipped.length > CAP || out.warnings.length > CAP,
  }
  if (out.create.length === 0 && Object.keys(out.templates).length === 0) {
    return ok({ mutation: null, summary })
  }

  const now = new Date().toISOString()
  const newNodes = materializePlannedNodes(out.create, project.nodes, now)

  const next: Project = {
    ...project,
    modified: now,
    templates: { ...project.templates, ...out.templates },
    nodes: [...project.nodes, ...newNodes],
  }
  return ok({ mutation: { next, label: 'Import NetBox', search: { upsert: newNodes } }, summary })
}
