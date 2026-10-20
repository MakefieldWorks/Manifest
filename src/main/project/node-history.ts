// Per-node chronological history. Walks the timeline events in push order,
// emitting an entry for each event that changed THIS node's state:
//
//   - 'snapshot' entries come from history.db rows (delta-encoded — only
//     present when the node actually changed at that snapshot)
//   - 'revert' entries are synthesized by reading the target snapshot's
//     manifest and comparing the node's state to whatever was last shown
//   - 'recover' entries are synthesized similarly from the recovery point's
//     manifest file
//
// Snapshots, reverts, and recoveries that left this node unchanged emit
// no entry — the result is a clean transition log.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { NodeHistoryEntry, Project, RecoveryPoint, Result, SnapshotTimelineEvent } from '../../shared/types'
import type { NodeHistoryRow } from '../history-index'
import type { Logger } from '../logger'

export interface NodeHistoryWalk {
  nodeId: string
  projectPath: string
  events: SnapshotTimelineEvent[]
  rowsBySnapshot: Map<string, NodeHistoryRow>
  recoveryPoints: RecoveryPoint[]
  readSnapshotManifest: (snapshotId: string) => Promise<string>
  parse: (raw: string) => Result<Project>
  logger: Logger
}

export async function walkNodeHistory(walk: NodeHistoryWalk): Promise<NodeHistoryEntry[]> {
  const { nodeId, projectPath, events, rowsBySnapshot, recoveryPoints, parse, logger } = walk

  // Cache snapshot manifests so multiple reverts targeting the same
  // snapshot don't pay the read cost twice.
  const snapshotManifestCache = new Map<string, Project | null>()
  const readSnapshotProject = async (snapshotId: string): Promise<Project | null> => {
    if (snapshotManifestCache.has(snapshotId)) return snapshotManifestCache.get(snapshotId)!
    try {
      const raw = await walk.readSnapshotManifest(snapshotId)
      const parsed = parse(raw)
      const result = parsed.ok ? parsed.data : null
      snapshotManifestCache.set(snapshotId, result)
      return result
    } catch {
      snapshotManifestCache.set(snapshotId, null)
      return null
    }
  }

  const entries: NodeHistoryEntry[] = []
  let lastState: NodeStateProjection = absentState()
  let order = 0

  for (const event of events) {
    if (event.type === 'snapshot') {
      const snapshotId = event.snapshotId
      if (!snapshotId) continue
      const row = rowsBySnapshot.get(snapshotId)
      if (!row) continue  // delta-encoded skip — node unchanged at this snapshot
      const newState: NodeStateProjection = {
        presence: row.presence,
        nodeName: row.nodeName,
        parentId: row.parentId,
        nodeOrder: row.nodeOrder,
        properties: row.properties,
        templateId: row.templateId,
      }
      if (statesEqual(newState, lastState)) continue
      entries.push({
        type: 'snapshot',
        entryId: snapshotId,
        createdAt: event.createdAt,
        snapshotName: snapshotId,
        note: event.note ?? null,
        order: order++,
        ...newState,
      })
      lastState = newState
    } else if (event.type === 'revert') {
      const target = event.targetSnapshotId
      if (!target) continue
      const targetProject = await readSnapshotProject(target)
      if (!targetProject) continue
      const newState = projectStateForNode(targetProject, nodeId)
      if (statesEqual(newState, lastState)) continue
      entries.push({
        type: 'revert',
        entryId: event.id,
        createdAt: event.createdAt,
        snapshotName: null,
        order: order++,
        ...newState,
        revertTargetSnapshotId: target,
        note: event.note ?? null,
      })
      lastState = newState
    } else if (event.type === 'recover') {
      const recoveryPointId = event.recoveryPointId
      if (!recoveryPointId) continue
      const point = recoveryPoints.find(p => p.id === recoveryPointId)
      if (!point) continue
      const recoveryFile = join(projectPath, ...point.manifestPath.split(/[\\/]/))
      let recoveredProject: Project | null = null
      try {
        if (existsSync(recoveryFile)) {
          const raw = readFileSync(recoveryFile, 'utf8')
          const parsed = parse(raw)
          if (parsed.ok) recoveredProject = parsed.data
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn('history: recovery manifest read failed', { recoveryPointId, error: msg })
      }
      if (!recoveredProject) continue
      const newState = projectStateForNode(recoveredProject, nodeId)
      if (statesEqual(newState, lastState)) continue
      entries.push({
        type: 'recover',
        entryId: event.id,
        createdAt: event.createdAt,
        snapshotName: null,
        order: order++,
        ...newState,
        recoveryPointId,
      })
      lastState = newState
    }
  }

  return entries
}

interface NodeStateProjection {
  presence: 'present' | 'absent'
  nodeName: string | null
  parentId: string | null
  nodeOrder: number | null
  properties: Record<string, string | number | boolean | null> | null
  templateId: string | null
}

function absentState(): NodeStateProjection {
  return {
    presence: 'absent',
    nodeName: null,
    parentId: null,
    nodeOrder: null,
    properties: null,
    templateId: null,
  }
}

function projectStateForNode(project: Project, nodeId: string): NodeStateProjection {
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) return absentState()
  return {
    presence: 'present',
    nodeName: node.name,
    parentId: node.parentId,
    nodeOrder: node.order,
    properties: node.properties,
    templateId: node.templateId ?? null,
  }
}

function statesEqual(a: NodeStateProjection, b: NodeStateProjection): boolean {
  if (a.presence !== b.presence) return false
  if (a.nodeName !== b.nodeName) return false
  if (a.parentId !== b.parentId) return false
  if (a.nodeOrder !== b.nodeOrder) return false
  if (a.templateId !== b.templateId) return false
  return propsEqualOrBothNull(a.properties, b.properties)
}

function propsEqualOrBothNull(
  a: Record<string, string | number | boolean | null> | null,
  b: Record<string, string | number | boolean | null> | null,
): boolean {
  if (a === null || b === null) return a === b
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in b)) return false
    if (a[key] !== b[key]) return false
  }
  return true
}
