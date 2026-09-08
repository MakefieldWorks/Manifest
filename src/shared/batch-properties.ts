import type { ManifestNode, Project, PropertyType, TemplateField } from './types'
import {
  coercePropertyValue,
  templateFields,
  validatePropertyKey,
  validatePropertyValue,
  validateReferenceTarget,
} from './validation'

export type PropertyValue = string | number | boolean | null

export interface BatchPropertyUpdateRequest {
  nodeIds: string[]
  key: string
  clear: boolean
  value?: PropertyValue
}

export interface BatchPropertyChange {
  nodeId: string
  nodeName: string
  before?: PropertyValue
  after?: PropertyValue
}

export type BatchPropertyPlan =
  | { valid: true; changes: BatchPropertyChange[] }
  | { valid: false; message: string; changes: [] }

export interface BatchPropertyOption {
  key: string
  field: TemplateField
  type: PropertyType
  compatible: boolean
  message?: string
}

function invalid(message: string): BatchPropertyPlan {
  return { valid: false, message, changes: [] }
}

export function planBatchPropertyUpdate(
  project: Project,
  request: BatchPropertyUpdateRequest,
): BatchPropertyPlan {
  if (!Array.isArray(request.nodeIds) || request.nodeIds.length < 2) {
    return invalid('Select at least two nodes to edit together.')
  }
  if (request.nodeIds.some(id => typeof id !== 'string') || new Set(request.nodeIds).size !== request.nodeIds.length) {
    return invalid('The selected node list is invalid.')
  }
  const key = typeof request.key === 'string' ? request.key.trim() : ''
  const keyCheck = validatePropertyKey(key)
  if (!keyCheck.valid) return invalid(keyCheck.message ?? 'Invalid property name')
  if (typeof request.clear !== 'boolean') return invalid('Choose whether to set or clear the property.')
  if (!request.clear && request.value === undefined) return invalid('Enter a value to apply.')

  const nodesById = new Map(project.nodes.map(node => [node.id, node]))
  const selected: ManifestNode[] = []
  for (const id of request.nodeIds) {
    const node = nodesById.get(id)
    if (!node) return invalid(`Selected node not found: ${id}`)
    selected.push(node)
  }

  const changes: BatchPropertyChange[] = []
  for (const node of selected) {
    const before = node.properties[key]
    let after: PropertyValue | undefined
    if (!request.clear) {
      const raw = request.value
      const field = templateFields(node.templateId ? project.templates?.[node.templateId] : undefined)[key]
      if (field) {
        const coerced = coercePropertyValue(raw, field)
        if (!coerced.valid) return invalid(`${node.name}: ${coerced.message ?? `Invalid value for “${key}”`}`)
        after = coerced.value ?? null
        if (field.type === 'reference') {
          const target = validateReferenceTarget(after, project.nodes, node.id)
          if (!target.valid) return invalid(`${node.name}: ${target.message ?? 'Invalid reference'}`)
        }
      } else {
        if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
          return invalid(`${node.name}: Invalid property value`)
        }
        const valueCheck = validatePropertyValue(raw)
        if (!valueCheck.valid) return invalid(`${node.name}: ${valueCheck.message ?? 'Invalid property value'}`)
        after = raw
      }
    }
    if (!Object.is(before, after)) changes.push({ nodeId: node.id, nodeName: node.name, before, after })
  }
  return { valid: true, changes }
}

export function batchPropertyOptions(project: Project, nodes: ManifestNode[]): BatchPropertyOption[] {
  const keys = new Set<string>()
  for (const node of nodes) {
    Object.keys(node.properties).forEach(key => keys.add(key))
    const fields = templateFields(node.templateId ? project.templates?.[node.templateId] : undefined)
    Object.keys(fields).forEach(key => keys.add(key))
  }
  return [...keys].sort((a, b) => a.localeCompare(b)).map(key => {
    const fields = nodes.flatMap(node => {
      const field = templateFields(node.templateId ? project.templates?.[node.templateId] : undefined)[key]
      return field ? [field] : []
    })
    const types = new Set(fields.map(field => field.type))
    if (types.size > 1) {
      return { key, field: { type: 'string' }, type: 'string', compatible: false, message: `Templates define “${key}” with different types.` }
    }
    const field = fields[0] ?? { type: 'string' as const }
    if (field.type === 'enum') {
      const optionSets = fields.map(candidate => new Set(candidate.options ?? []))
      const options = (field.options ?? []).filter(option => optionSets.every(set => set.has(option)))
      if (options.length === 0) {
        return { key, field, type: field.type, compatible: false, message: 'No enum value is valid for every selected node.' }
      }
      return { key, field: { ...field, options }, type: field.type, compatible: true }
    }
    return { key, field, type: field.type, compatible: true }
  })
}
