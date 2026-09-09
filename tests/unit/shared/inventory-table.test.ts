import { describe, expect, it } from 'vitest'
import { buildInventoryRows, inventoryPropertyKeys, isInventoryColumn, sortInventoryRows } from '../../../src/shared/inventory-table'
import type { Project } from '../../../src/shared/types'

const timestamp = '2026-01-01T00:00:00.000Z'
const project: Project = {
  version: 2,
  id: 'inventory',
  name: 'Lab',
  created: timestamp,
  modified: timestamp,
  templates: { device: { label: 'Device', fields: { serial: { type: 'string' }, firmware: { type: 'version' } } } },
  nodes: [
    { id: 'root', parentId: null, name: 'Lab', order: 0, properties: {}, created: timestamp, modified: timestamp },
    { id: 'rack', parentId: 'root', name: 'Rack 2', order: 0, properties: {}, created: timestamp, modified: timestamp },
    { id: 'b', parentId: 'rack', name: 'Device 10', order: 0, templateId: 'device', properties: { serial: 'B', online: false }, created: timestamp, modified: timestamp },
    { id: 'a', parentId: 'rack', name: 'Device 2', order: 1, templateId: 'device', properties: { serial: 'A' }, created: timestamp, modified: timestamp },
  ],
}

describe('inventory table', () => {
  it('builds paths, template labels, and scalar property cells', () => {
    const columns = ['name', 'path', 'template', 'property:serial', 'property:online'] as const
    const rows = buildInventoryRows(project, project.nodes.slice(2), [...columns])
    expect(rows[0].values).toEqual({
      name: 'Device 10', path: 'Lab / Rack 2 / Device 10', template: 'Device',
      'property:serial': 'B', 'property:online': 'false',
    })
    expect(inventoryPropertyKeys(project)).toEqual(['firmware', 'online', 'serial'])
  })

  it('sorts naturally and validates bounded column identifiers', () => {
    const rows = buildInventoryRows(project, project.nodes.slice(2), ['name'])
    expect(sortInventoryRows(rows, 'name', 'asc').map(row => row.nodeId)).toEqual(['a', 'b'])
    expect(sortInventoryRows(rows, 'name', 'desc').map(row => row.nodeId)).toEqual(['b', 'a'])
    expect(isInventoryColumn('property:serial')).toBe(true)
    expect(isInventoryColumn('property:')).toBe(false)
  })
})
