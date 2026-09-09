import { describe, expect, it } from 'vitest'
import {
  filterDiffsToComparisonScope,
  filterTemplateDiffsToComparisonScope,
  resolveComparisonScope,
} from '../../../src/shared/comparison-scope'
import type { DiffEntry, Project, TemplateDiffEntry } from '../../../src/shared/types'

const TS = '2026-01-01T00:00:00.000Z'

function project(nodes: Project['nodes']): Project {
  return {
    version: 3,
    id: 'project',
    name: 'Lab',
    created: TS,
    modified: TS,
    nodes,
    templates: {},
  }
}

function node(id: string, name: string, parentId: string | null, templateId?: string) {
  return { id, name, parentId, order: 0, properties: {}, created: TS, modified: TS, templateId }
}

describe('comparison scope', () => {
  it('unions descendants from both sides and uses the latest path', () => {
    const before = project([
      node('root', 'Lab', null),
      node('rack', 'Rack A', 'root'),
      node('removed', 'Old Device', 'rack'),
    ])
    const after = project([
      node('root', 'Lab', null),
      node('room', 'Room 1', 'root'),
      node('rack', 'Rack Alpha', 'room'),
      node('added', 'New Device', 'rack'),
    ])

    const result = resolveComparisonScope(before, after, 'rack')
    expect(result?.scope).toEqual({
      nodeId: 'rack',
      name: 'Rack Alpha',
      path: 'Lab / Room 1 / Rack Alpha',
    })
    expect([...result!.nodeIds].sort()).toEqual(['added', 'rack', 'removed'])
  })

  it('filters node and schema changes to entities used inside the scope', () => {
    const before = project([
      node('root', 'Lab', null),
      node('rack', 'Rack A', 'root'),
      node('inside', 'Inside', 'rack', 'device'),
      node('outside', 'Outside', 'root', 'other'),
    ])
    const scope = resolveComparisonScope(before, before, 'rack')!
    const diffs = [
      { nodeId: 'inside', changeType: 'renamed' },
      { nodeId: 'outside', changeType: 'renamed' },
    ] as DiffEntry[]
    const templateDiffs = [
      { templateId: 'device', templateLabel: 'Device', changeType: 'field-added' },
      { templateId: 'other', templateLabel: 'Other', changeType: 'field-added' },
    ] as TemplateDiffEntry[]

    expect(filterDiffsToComparisonScope(diffs, scope.nodeIds)).toEqual([diffs[0]])
    expect(filterTemplateDiffsToComparisonScope(templateDiffs, before, before, scope.nodeIds))
      .toEqual([templateDiffs[0]])
  })

  it('returns null when the selected node exists on neither side', () => {
    const empty = project([node('root', 'Lab', null)])
    expect(resolveComparisonScope(empty, empty, 'missing')).toBeNull()
  })
})
