// Compare two project states (snapshots or the live project) and format the
// result as a shareable report. Ref resolution is injected so this module
// never reaches into git or the in-memory project directly.

import type { ComparisonScope, DiffEntry, Project, Result, Snapshot } from '../../shared/types'
import { ok, err, ErrorCode } from '../../shared/errors'
import { buildNodePathResolver } from '../../shared/subtree'
import { templateLabel } from '../../shared/validation'
import { diffProjects, diffTemplates } from '../../shared/diff-engine'
import {
  filterDiffsToComparisonScope,
  filterTemplateDiffsToComparisonScope,
  resolveComparisonScope,
} from '../../shared/comparison-scope'
import { isCurrentRef, CURRENT_PROJECT_LABEL } from '../../shared/snapshot-ref'
import {
  formatDiffReportMarkdown,
  formatDiffReportCsv,
  formatDiffReportHtml,
  type ReportFormat,
  type ReportContext,
} from '../../shared/report'

export interface LoadedComparison {
  projectA: Project
  projectB: Project
  diffs: DiffEntry[]
  templateDiffs: ReturnType<typeof diffTemplates>
  scope: ComparisonScope | null
}

/** Resolve both refs, diff them, and apply an optional subtree scope. */
export async function loadAndDiff(
  resolve: (ref: string) => Promise<Result<Project>>,
  a: string,
  b: string,
  scopeNodeId: unknown = null,
): Promise<Result<LoadedComparison>> {
  if (scopeNodeId !== null && scopeNodeId !== undefined && (
    typeof scopeNodeId !== 'string' || scopeNodeId.length === 0
  )) {
    return err(ErrorCode.VALIDATION_FAILED, 'Comparison scope must be a valid node ID')
  }
  const requestedScopeId = typeof scopeNodeId === 'string' ? scopeNodeId : null

  // Comparing a ref against itself is an empty diff by definition. The renderer
  // already blocks it, but guard here too (defense-in-depth for direct callers)
  // and skip the redundant resolve/git-read.
  let projectA: Project
  let projectB: Project
  if (a === b) {
    const only = await resolve(a)
    if (!only.ok) return only as Result<LoadedComparison>
    projectA = only.data
    projectB = only.data
  } else {
    const [resolvedA, resolvedB] = await Promise.all([
      resolve(a),
      resolve(b),
    ])
    if (!resolvedA.ok) return resolvedA as Result<LoadedComparison>
    if (!resolvedB.ok) return resolvedB as Result<LoadedComparison>
    projectA = resolvedA.data
    projectB = resolvedB.data
  }

  const allDiffs = a === b ? [] : diffProjects(projectA, projectB)
  const allTemplateDiffs = a === b ? [] : diffTemplates(projectA, projectB)
  if (!requestedScopeId) {
    return ok({ projectA, projectB, diffs: allDiffs, templateDiffs: allTemplateDiffs, scope: null })
  }

  const resolvedScope = resolveComparisonScope(projectA, projectB, requestedScopeId)
  if (!resolvedScope) {
    return err(ErrorCode.VALIDATION_FAILED, 'The selected comparison scope does not exist in either project state')
  }
  return ok({
    projectA,
    projectB,
    diffs: filterDiffsToComparisonScope(allDiffs, resolvedScope.nodeIds),
    templateDiffs: filterTemplateDiffsToComparisonScope(
      allTemplateDiffs,
      projectA,
      projectB,
      resolvedScope.nodeIds,
    ),
    scope: resolvedScope.scope,
  })
}

// Format a loaded comparison. `snapshots` supplies header metadata (date,
// short commit hash, note) that loadAndDiff does not carry.
export function formatComparisonReport(
  loaded: LoadedComparison,
  from: string,
  to: string,
  format: ReportFormat,
  snapshots: Snapshot[],
  fallbackProjectName: string,
): { content: string; suggestedName: string } {
  const { projectA, projectB, diffs, templateDiffs, scope } = loaded
  const meta = (name: string) => {
    // The current-project side has no Snapshot record; label it and leave
    // date/hash blank (it's the live working copy, not a committed snapshot).
    if (isCurrentRef(name)) {
      return { name: CURRENT_PROJECT_LABEL, date: '', hash: '', note: null }
    }
    const s = snapshots.find(x => x.name === name)
    return {
      name,
      date: s ? s.createdAt.slice(0, 16).replace('T', ' ') : '',
      hash: s ? s.commitHash.slice(0, 7) : '',
      note: s?.note ?? null,
    }
  }

  const ctx: ReportContext = {
    projectName: projectB.name || fallbackProjectName,
    from: meta(from),
    to: meta(to),
    generatedAt: new Date().toISOString(),
    scope,
    oldPathById: buildNodePathResolver(projectA.nodes),
    templateLabelOld: (v) => (v ? templateLabel(projectA.templates?.[String(v)], String(v)) : '(none)'),
    templateLabelNew: (v) => (v ? templateLabel(projectB.templates?.[String(v)], String(v)) : '(none)'),
  }

  let content: string
  switch (format) {
    case 'markdown':
      content = formatDiffReportMarkdown(diffs, templateDiffs, ctx)
      break
    case 'csv':
      content = formatDiffReportCsv(diffs, templateDiffs, ctx)
      break
    case 'html':
      content = formatDiffReportHtml(diffs, templateDiffs, ctx)
      break
  }

  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'snapshot'
  // The current-project side gets a clearer filename token than safe('@current')
  // ('current'), which would otherwise read like an ordinary snapshot called
  // "current". This is a save-dialog default the user can rename, so a
  // residual clash with a snapshot literally named "current-project" is
  // tolerable, not a correctness concern.
  const fileToken = (ref: string) => (isCurrentRef(ref) ? 'current-project' : safe(ref))
  const ext: Record<ReportFormat, string> = { markdown: 'md', csv: 'csv', html: 'html' }
  const scopeToken = scope ? `-${safe(scope.name)}-${safe(scope.nodeId)}` : ''
  const suggestedName = `${safe(ctx.projectName)}-changes-${fileToken(from)}-to-${fileToken(to)}${scopeToken}.${ext[format]}`
  return { content, suggestedName }
}
