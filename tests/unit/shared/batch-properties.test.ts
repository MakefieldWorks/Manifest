import { describe, expect, it } from 'vitest'
import { batchPropertyOptions, planBatchPropertyUpdate } from '../../../src/shared/batch-properties'
import type { Project } from '../../../src/shared/types'

const project: Project = {
  version: 1,
  id: 'project',
  name: 'Lab',
  created: '',
  modified: '',
  templates: {
    device: { label: 'Device', fields: {
      firmware: { type: 'version' },
      ports: { type: 'number' },
      status: { type: 'enum', options: ['ready', 'offline'] },
    } },
    legacy: { label: 'Legacy', fields: {
      firmware: { type: 'version' },
      status: { type: 'enum', options: ['ready', 'retired'] },
    } },
  },
  nodes: [
    { id: 'root', parentId: null, name: 'Lab', order: 0, properties: {}, created: '', modified: '' },
    { id: 'a', parentId: 'root', name: 'A', order: 0, templateId: 'device', properties: { firmware: 'v1', ports: 4 }, created: '', modified: '' },
    { id: 'b', parentId: 'root', name: 'B', order: 1, templateId: 'legacy', properties: { firmware: 'v2' }, created: '', modified: '' },
  ],
}

describe('batch property planning', () => {
  it('reports exact mixed-value changes and coerces each typed target', () => {
    const plan = planBatchPropertyUpdate(project, { nodeIds: ['a', 'b'], key: 'firmware', clear: false, value: 'v3' })
    expect(plan).toEqual({ valid: true, changes: [
      { nodeId: 'a', nodeName: 'A', before: 'v1', after: 'v3' },
      { nodeId: 'b', nodeName: 'B', before: 'v2', after: 'v3' },
    ] })
    expect(planBatchPropertyUpdate(project, { nodeIds: ['a', 'b'], key: 'ports', clear: false, value: '8' })).toEqual({
      valid: true,
      changes: [
        { nodeId: 'a', nodeName: 'A', before: 4, after: 8 },
        { nodeId: 'b', nodeName: 'B', before: undefined, after: 8 },
      ],
    })
  })

  it('rejects the complete plan when any selected node or value is invalid', () => {
    expect(planBatchPropertyUpdate(project, { nodeIds: ['a'], key: 'firmware', clear: false, value: 'v3' }).valid).toBe(false)
    expect(planBatchPropertyUpdate(project, { nodeIds: ['a', 'missing'], key: 'firmware', clear: false, value: 'v3' }).valid).toBe(false)
    expect(planBatchPropertyUpdate(project, { nodeIds: ['a', 'b'], key: 'status', clear: false, value: 'offline' }).valid).toBe(false)
  })

  it('offers only values compatible across selected template definitions', () => {
    const options = batchPropertyOptions(project, project.nodes.filter(node => node.id === 'a' || node.id === 'b'))
    expect(options.find(option => option.key === 'firmware')?.compatible).toBe(true)
    expect(options.find(option => option.key === 'status')?.field.options).toEqual(['ready'])
  })
})
