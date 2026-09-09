import { describe, expect, it } from 'vitest'
import {
  filterInventoryNodes,
  hasInventoryFilters,
  inventoryFilterSnippet,
  missingRequiredKeys,
} from '../../../src/shared/inventory-filters'
import type { ManifestNode, Project } from '../../../src/shared/types'

const timestamp = '2026-01-01T00:00:00.000Z'

function node(
  id: string,
  parentId: string | null,
  name: string,
  properties: ManifestNode['properties'] = {},
  templateId?: string,
): ManifestNode {
  return { id, parentId, name, order: 0, properties, templateId, created: timestamp, modified: timestamp }
}

const project: Project = {
  version: 2,
  id: 'project',
  name: 'Inventory',
  created: timestamp,
  modified: timestamp,
  templates: {
    device: {
      label: 'Device',
      fields: {
        serial: { type: 'string', required: true },
        firmware: { type: 'version' },
      },
    },
  },
  nodes: [
    node('root', null, 'Inventory'),
    node('rack-a', 'root', 'Rack A'),
    node('device-a', 'rack-a', 'Device A', { serial: '', firmware: 'V3.2' }, 'device'),
    node('device-b', 'rack-a', 'Device B', { serial: 'SN-2', firmware: 'v2.0' }, 'device'),
    node('rack-b', 'root', 'Rack B'),
    node('device-c', 'rack-b', 'Device C', { firmware: 'v3.8' }),
  ],
}

describe('inventory filters', () => {
  it('detects active filters and scopes to a subtree including its root', () => {
    expect(hasInventoryFilters({})).toBe(false)
    expect(hasInventoryFilters({ subtreeId: 'rack-a' })).toBe(true)
    expect(filterInventoryNodes(project, { subtreeId: 'rack-a' }).map(item => item.id))
      .toEqual(['rack-a', 'device-a', 'device-b'])
    expect(filterInventoryNodes(project, { subtreeId: 'missing' })).toEqual([])
  })

  it('combines template and case-insensitive property predicates', () => {
    expect(filterInventoryNodes(project, { templateId: 'device' }).map(item => item.id))
      .toEqual(['device-a', 'device-b'])
    expect(filterInventoryNodes(project, {
      subtreeId: 'rack-a',
      templateId: 'device',
      propertyKey: 'firmware',
      propertyOperator: 'contains',
      propertyValue: '2.0',
    }).map(item => item.id)).toEqual(['device-b'])
    expect(filterInventoryNodes(project, {
      propertyKey: 'firmware',
      propertyOperator: 'equals',
      propertyValue: 'v3.2',
    }).map(item => item.id)).toEqual(['device-a'])
  })

  it('finds missing required values and explains filter-only matches', () => {
    const device = project.nodes.find(item => item.id === 'device-a')!
    expect(missingRequiredKeys(project, device)).toEqual(['serial'])
    expect(filterInventoryNodes(project, { missingRequired: true }).map(item => item.id))
      .toEqual(['device-a'])
    expect(inventoryFilterSnippet(project, device, { missingRequired: true })).toBe('Missing: serial')
    expect(inventoryFilterSnippet(project, device, { propertyKey: 'firmware' })).toBe('firmware: V3.2')
  })
})
