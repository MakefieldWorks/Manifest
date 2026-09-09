import { describe, expect, it } from 'vitest'
import {
  filterInventoryNodes,
  hasInventoryFilters,
  hasPropertyPredicate,
  inventoryFilterSnippet,
  missingRequiredKeys,
  validateInventoryFilters,
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
    node('device-b', 'rack-a', 'Device B', { serial: 'SN-2', firmware: 'v2.0', ports: 8, online: false, note: null }, 'device'),
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
    expect(filterInventoryNodes(project, {
      propertyKey: 'ports', propertyOperator: 'equals', propertyValue: '8',
    }).map(item => item.id)).toEqual(['device-b'])
    expect(filterInventoryNodes(project, {
      propertyKey: 'online', propertyOperator: 'equals', propertyValue: 'false',
    }).map(item => item.id)).toEqual(['device-b'])
    expect(filterInventoryNodes(project, {
      propertyKey: 'note', propertyOperator: 'equals', propertyValue: 'null',
    })).toEqual([])
  })

  it('does not activate an incomplete property predicate', () => {
    for (const operator of ['equals', 'contains'] as const) {
      const filters = { propertyKey: 'firmware', propertyOperator: operator, propertyValue: '' }
      expect(hasPropertyPredicate(filters)).toBe(false)
      expect(hasInventoryFilters(filters)).toBe(false)
      expect(filterInventoryNodes(project, filters)).toEqual(project.nodes)
    }
  })

  it('finds missing required values and explains filter-only matches', () => {
    const device = project.nodes.find(item => item.id === 'device-a')!
    expect(missingRequiredKeys(project, device)).toEqual(['serial'])
    expect(filterInventoryNodes(project, { missingRequired: true }).map(item => item.id))
      .toEqual(['device-a'])
    expect(missingRequiredKeys(project, project.nodes.find(item => item.id === 'device-c')!)).toEqual([])
    expect(inventoryFilterSnippet(project, device, { missingRequired: true })).toBe('Missing: serial')
    expect(inventoryFilterSnippet(project, device, { propertyKey: 'firmware', propertyValue: 'V3.2' }))
      .toBe('firmware: V3.2')
  })

  it('validates runtime input lengths and normalizes unknown operators', () => {
    expect(validateInventoryFilters({ propertyKey: 'x'.repeat(65), propertyValue: 'value' }))
      .toMatchObject({ valid: false })
    expect(validateInventoryFilters({ missingRequired: 'yes' })).toMatchObject({ valid: false })
    expect(validateInventoryFilters({
      propertyKey: 'firmware', propertyValue: 'v3', propertyOperator: 'starts-with',
    })).toEqual({
      valid: true,
      filters: { propertyKey: 'firmware', propertyValue: 'v3', propertyOperator: 'equals' },
    })
  })
})
