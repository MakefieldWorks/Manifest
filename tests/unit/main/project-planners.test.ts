// Direct tests for the pure planners in src/main/project/. The manager-level
// suites cover behavior end to end; these pin the planner contract itself:
// the next project, the edit label, and the search work described as data.

import { describe, it, expect } from 'vitest'
import { planNodeCreate, planNodeDelete, planNodeMove } from '../../../src/main/project/nodes'
import { planTemplateDelete } from '../../../src/main/project/templates'
import type { Project } from '../../../src/shared/types'

const now = '2026-01-01T00:00:00.000Z'

function project(): Project {
  const node = (id: string, parentId: string | null, name: string, order: number, extra = {}) => ({
    id, parentId, name, order, properties: {}, created: now, modified: now, ...extra,
  })
  return {
    version: 3, id: 'p', name: 'P', created: now, modified: now, path: '/tmp/p',
    templates: { rack: { label: 'Rack', fields: { peer: { type: 'reference' } } } },
    nodes: [
      node('root', null, 'Root', 0),
      node('a', 'root', 'A', 0),
      node('b', 'root', 'B', 1, { templateId: 'rack', properties: { peer: 'a' } }),
      node('a1', 'a', 'A1', 0),
    ],
  } as Project
}

describe('project planners', () => {
  it('describes node creation as one upsert and leaves the input untouched', () => {
    const input = project()
    const planned = planNodeCreate(input, 'root', 'C')
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const created = planned.data.next.nodes.at(-1)!
    expect(created).toMatchObject({ parentId: 'root', name: 'C', order: 2 })
    expect(planned.data.label).toBe('Add node')
    expect(planned.data.search).toEqual({ upsert: [created] })
    expect(input.nodes).toHaveLength(4)
  })

  it('returns a null mutation when a move would not change the order', () => {
    const planned = planNodeMove(project(), 'a', 'root', 0)
    expect(planned).toEqual({ ok: true, data: null })
  })

  it('blocks deleting a referenced subtree unless unlinking, then removes and re-indexes', () => {
    const blocked = planNodeDelete(project(), 'a')
    expect(blocked.ok).toBe(false)

    const planned = planNodeDelete(project(), 'a', { unlinkReferences: true })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.data.search.remove?.sort()).toEqual(['a', 'a1'])
    expect(planned.data.search.upsert?.map(node => [node.id, node.properties.peer, node.order])).toEqual([['b', null, 0]])
  })

  it('asks for a full search rebuild when a template changes', () => {
    const planned = planTemplateDelete(project(), 'rack')
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.data.search).toEqual({ rebuild: true })
    expect(planned.data.next.nodes.find(node => node.id === 'b')?.templateId).toBeNull()
  })
})
