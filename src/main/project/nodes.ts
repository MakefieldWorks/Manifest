// Node CRUD planners. Each takes the current project and a request and
// returns either a validation error or a ProjectMutation describing the next
// project; ProjectManager commits it. A null mutation means "already in that
// state" and is returned to the caller without recording an edit.

import { v7 as uuidv7 } from 'uuid'
import type { ManifestNode, NodeTemplate, Project, Result } from '../../shared/types'
import { ok, err, ErrorCode } from '../../shared/errors'
import { collectSubtreeIds } from '../../shared/subtree'
import { planBatchPropertyUpdate, type BatchPropertyUpdateRequest } from '../../shared/batch-properties'
import {
  validateNodeName,
  validateDuplicateNodeName,
  validatePropertyKey,
  validatePropertyValue,
  coercePropertyValue,
  templateFields,
} from '../../shared/validation'
import { findExternalReferencesTo, validateReferenceFieldValue } from './references'
import type { ProjectMutation } from './mutation'

export interface NodeUpdateChanges {
  name?: string
  properties?: Record<string, string | number | boolean | null>
  templateId?: string | null
}

// Create a child node under parentId.
// New node is appended as the last child (order = sibling count).
export function planNodeCreate(
  project: Project,
  parentId: string,
  name: string,
  templateId?: string | null,
): Result<ProjectMutation> {
  const nameValidation = validateNodeName(name)
  if (!nameValidation.valid) {
    return err(ErrorCode.VALIDATION_FAILED, nameValidation.message ?? 'Invalid name')
  }

  // Parent must exist.
  const parent = project.nodes.find(n => n.id === parentId)
  if (!parent) {
    return err(ErrorCode.INVALID_HIERARCHY, `Parent node not found: ${parentId}`)
  }

  // Sibling name uniqueness (case-insensitive).
  const siblings = project.nodes.filter(n => n.parentId === parentId)
  if (hasSiblingNameConflict(project.nodes, name, parentId, null)) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      `A node named "${name}" already exists under this parent`
    )
  }

  // Optional template binding. When bound, seed properties from field defaults.
  let template: NodeTemplate | undefined
  if (templateId !== undefined && templateId !== null) {
    template = project.templates?.[templateId]
    if (!template) {
      return err(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${templateId}`)
    }
  }
  const seededProperties = template ? seedDefaults(template) : {}

  const now = new Date().toISOString()
  const newNode: ManifestNode = {
    id: uuidv7(),
    parentId,
    name,
    order: siblings.length,
    properties: seededProperties,
    ...(templateId !== undefined && templateId !== null ? { templateId } : {}),
    created: now,
    modified: now,
  }

  const next: Project = {
    ...project,
    modified: now,
    nodes: [...project.nodes, newNode],
  }
  return ok({ next, label: 'Add node', search: { upsert: [newNode] } })
}

// Duplicate an entire subtree as one reversible mutation. Templates are shared;
// only currently typed references into the source subtree are remapped.
export function planNodeDuplicate(project: Project, id: string, name: string): Result<ProjectMutation> {
  const source = project.nodes.find(node => node.id === id)
  if (!source || source.parentId === null) {
    return err(ErrorCode.INVALID_HIERARCHY, source ? 'The project root cannot be duplicated.' : 'Node not found.')
  }
  const projectIds = new Set(project.nodes.map(node => node.id))
  if (projectIds.size !== project.nodes.length || !projectIds.has(source.parentId)) {
    return err(ErrorCode.INVALID_HIERARCHY, 'Repair duplicate node IDs or the missing parent before duplicating this node.')
  }
  if (typeof name !== 'string') return err(ErrorCode.VALIDATION_FAILED, 'Copy name must be text')
  const copyName = name.trim()
  const siblings = project.nodes.filter(node => node.parentId === source.parentId).sort((a, b) => a.order - b.order)
  const validation = validateDuplicateNodeName(copyName, siblings.map(node => node.name))
  if (!validation.valid) return err(ErrorCode.VALIDATION_FAILED, validation.message!)

  const ids = collectSubtreeIds(project.nodes, id)
  const copiesById = new Map([...ids].map(originalId => [originalId, uuidv7()]))
  const insertionOrder = siblings.findIndex(node => node.id === id) + 1
  const now = new Date().toISOString()
  const copies = project.nodes.filter(node => ids.has(node.id)).map(node => {
    const properties = { ...node.properties }
    const fields = templateFields(node.templateId ? project.templates?.[node.templateId] : undefined)
    for (const [key, field] of Object.entries(fields)) {
      const target = properties[key]
      if (field?.type === 'reference' && typeof target === 'string' && copiesById.has(target)) {
        properties[key] = copiesById.get(target)!
      }
    }
    return {
      ...node,
      id: copiesById.get(node.id)!,
      parentId: node.id === id ? source.parentId : copiesById.get(node.parentId!)!,
      name: node.id === id ? copyName : node.name,
      order: node.id === id ? insertionOrder : node.order,
      properties,
      created: now,
      modified: now,
    }
  })
  // Normalize the parent's complete sibling order around the insertion. This
  // matches move/delete semantics and also repairs gaps or ties tolerated in
  // hand-edited project files.
  const siblingOrders = new Map(siblings.map((node, index) => [node.id, index < insertionOrder ? index : index + 1]))
  const next: Project = {
    ...project,
    modified: now,
    nodes: [
      ...project.nodes.map(node => {
        const order = siblingOrders.get(node.id)
        return order !== undefined && order !== node.order ? { ...node, order, modified: now } : node
      }),
      ...copies,
    ],
  }
  return ok({ next, label: 'Duplicate subtree', search: { upsert: copies } })
}

// Apply one property change to an explicit node set as one atomic, undoable edit.
export function planNodeBatchPropertyUpdate(
  project: Project,
  request: BatchPropertyUpdateRequest,
): Result<{ mutation: ProjectMutation | null; changesApplied: number }> {
  if (!request || typeof request !== 'object') {
    return err(ErrorCode.VALIDATION_FAILED, 'Invalid batch property update')
  }
  const plan = planBatchPropertyUpdate(project, request)
  if (!plan.valid) return err(ErrorCode.VALIDATION_FAILED, plan.message)
  if (plan.changes.length === 0) return ok({ mutation: null, changesApplied: 0 })

  const now = new Date().toISOString()
  const changesById = new Map(plan.changes.map(change => [change.nodeId, change]))
  const updatedNodes: ManifestNode[] = []
  const key = request.key.trim()
  const nodes = project.nodes.map(node => {
    const change = changesById.get(node.id)
    if (!change) return node
    const properties = { ...node.properties }
    if (change.after === undefined) delete properties[key]
    else properties[key] = change.after
    const updated = { ...node, properties, modified: now }
    updatedNodes.push(updated)
    return updated
  })
  const next = { ...project, modified: now, nodes }
  return ok({
    mutation: { next, label: 'Batch edit properties', search: { upsert: updatedNodes } },
    changesApplied: plan.changes.length,
  })
}

// Update a node's name, properties, and/or template binding.
export function planNodeUpdate(project: Project, id: string, changes: NodeUpdateChanges): Result<ProjectMutation> {
  const node = project.nodes.find(n => n.id === id)
  if (!node) return err(ErrorCode.VALIDATION_FAILED, `Node not found: ${id}`)

  if (changes.name !== undefined) {
    const nameValidation = validateNodeName(changes.name)
    if (!nameValidation.valid) {
      return err(ErrorCode.VALIDATION_FAILED, nameValidation.message ?? 'Invalid name')
    }
    if (hasSiblingNameConflict(project.nodes, changes.name, node.parentId, id)) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        `A node named "${changes.name}" already exists under this parent`
      )
    }
  }

  // Resolve the effective template after this update (null = unbind/freeform).
  const nextTemplateId =
    changes.templateId !== undefined ? changes.templateId : node.templateId ?? null
  let template: NodeTemplate | undefined
  if (nextTemplateId !== null && nextTemplateId !== undefined) {
    template = project.templates?.[nextTemplateId]
    if (!template) {
      return err(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${nextTemplateId}`)
    }
  }

  // Re-coerce/validate properties whenever the property set OR the template
  // binding changes. Binding a node to a template (selector sends only
  // { templateId }) must validate the node's EXISTING properties against the
  // new template — otherwise an ad-hoc value like status:"bogus" could become
  // silently invalid under an enum field. Keys matching a template field are
  // coerced strictly to the field type; ad-hoc keys use lenient validation.
  const templateBindingChanged =
    changes.templateId !== undefined && (changes.templateId ?? null) !== (node.templateId ?? null)
  const recoerce = changes.properties !== undefined || templateBindingChanged

  let nextProperties = node.properties
  if (recoerce) {
    const baseProps = changes.properties !== undefined ? changes.properties : node.properties
    const coerced: Record<string, string | number | boolean | null> = {}
    for (const [key, value] of Object.entries(baseProps)) {
      const keyValidation = validatePropertyKey(key)
      if (!keyValidation.valid) {
        return err(ErrorCode.VALIDATION_FAILED, keyValidation.message ?? 'Invalid property key')
      }
      const field = templateFields(template)[key]
      if (field && value !== null) {
        const result = coercePropertyValue(value, field)
        if (!result.valid) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            `Property "${key}": ${result.message ?? 'invalid value'}`
          )
        }
        const targetCheck = validateReferenceFieldValue(result.value, field, project.nodes, node.id)
        if (!targetCheck.valid) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            `Property "${key}": ${targetCheck.message ?? 'invalid reference'}`
          )
        }
        coerced[key] = result.value ?? null
      } else {
        if (value !== null) {
          const valueValidation = validatePropertyValue(value)
          if (!valueValidation.valid) {
            return err(ErrorCode.VALIDATION_FAILED, valueValidation.message ?? 'Invalid property value')
          }
        }
        coerced[key] = value
      }
    }
    nextProperties = coerced
  }

  const now = new Date().toISOString()
  const updatedNode: ManifestNode = {
    ...node,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(recoerce ? { properties: nextProperties } : {}),
    ...(changes.templateId !== undefined ? { templateId: changes.templateId } : {}),
    modified: now,
  }

  const next: Project = {
    ...project,
    modified: now,
    nodes: project.nodes.map(n => n.id === id ? updatedNode : n),
  }
  return ok({ next, label: 'Edit node', search: { upsert: [updatedNode] } })
}

// Delete a node and all its descendants.
// Root node (parentId === null) cannot be deleted.
//
// By default, deletion is blocked when a surviving node's live `reference`
// property — or a template `reference` field default — points into the
// deletion set, including mutual or cyclic references across subtrees the user
// can't easily clear by hand. `options.unlinkReferences` is the explicit force
// path: it nulls those reference properties on the survivors and clears the
// stale template defaults, then deletes. Safe-by-default otherwise — the
// blocker list rides in the error context so the renderer can show it and
// confirm before forcing.
export function planNodeDelete(
  project: Project,
  id: string,
  options?: { unlinkReferences?: boolean },
): Result<ProjectMutation> {
  const node = project.nodes.find(n => n.id === id)
  if (!node) return err(ErrorCode.VALIDATION_FAILED, `Node not found: ${id}`)

  if (node.parentId === null) {
    return err(ErrorCode.INVALID_HIERARCHY, 'Cannot delete the root node')
  }

  // Collect node + all descendants.
  const toDelete = collectDescendants(project.nodes, id)
  const blockers = findExternalReferencesTo(project, toDelete)
  if (blockers.length > 0 && !options?.unlinkReferences) {
    const n = blockers.length
    const message =
      n === 1 && blockers[0].kind === 'node'
        ? `Cannot delete "${node.name}" because "${blockers[0].nodeName}" field "${blockers[0].key}" references it`
        : `Cannot delete "${node.name}" because ${n} reference${n === 1 ? '' : 's'} ${n === 1 ? 'points' : 'point'} into it`
    return err(ErrorCode.VALIDATION_FAILED, message, { blockers })
  }

  // Force path: clear each blocking reference. A node may hold more than one
  // blocking reference and a template may have more than one defaulting field,
  // so group keys by holder (node id / template id).
  const now = new Date().toISOString()
  const unlinkKeysByNode = new Map<string, Set<string>>()
  const clearDefaultsByTemplate = new Map<string, Set<string>>()
  for (const b of blockers) {
    if (b.kind === 'node' && b.nodeId) {
      let keys = unlinkKeysByNode.get(b.nodeId)
      if (!keys) unlinkKeysByNode.set(b.nodeId, (keys = new Set()))
      keys.add(b.key)
    } else if (b.kind === 'template-default' && b.templateId) {
      let keys = clearDefaultsByTemplate.get(b.templateId)
      if (!keys) clearDefaultsByTemplate.set(b.templateId, (keys = new Set()))
      keys.add(b.key)
    }
  }

  // Re-number siblings after deletion; unlink survivors in the same pass.
  const remaining = project.nodes
    .filter(n => !toDelete.has(n.id))
    .map(n => {
      const keys = unlinkKeysByNode.get(n.id)
      if (!keys) return n
      const properties = { ...n.properties }
      for (const key of keys) properties[key] = null
      return { ...n, properties, modified: now }
    })
  const reordered = renumberSiblings(remaining, node.parentId)

  // Drop stale reference defaults from affected templates (immutably).
  let nextTemplates = project.templates
  if (clearDefaultsByTemplate.size > 0) {
    nextTemplates = { ...project.templates }
    for (const [templateId, keys] of clearDefaultsByTemplate) {
      const template = nextTemplates[templateId]
      if (!template) continue
      const fields = { ...template.fields }
      for (const key of keys) {
        if (!fields[key]) continue
        const { default: _drop, ...rest } = fields[key]
        fields[key] = rest
      }
      nextTemplates[templateId] = { ...template, fields }
    }
  }

  const next: Project = {
    ...project,
    modified: now,
    nodes: reordered,
    ...(nextTemplates ? { templates: nextTemplates } : {}),
  }

  // Re-index unlinked survivors so search reflects the cleared references.
  const unlinked = unlinkKeysByNode.size > 0 ? reordered.filter(n => unlinkKeysByNode.has(n.id)) : []
  return ok({ next, label: 'Delete node', search: { remove: Array.from(toDelete), upsert: unlinked } })
}

// Move a node to a new parent (reparent) or reorder within current parent.
// Reparented nodes are appended as the last child of the target parent.
// For reordering within the same parent, newOrder specifies the target position.
// Returns a null mutation when the node is already at the requested position.
export function planNodeMove(
  project: Project,
  id: string,
  newParentId: string,
  newOrder: number,
): Result<ProjectMutation | null> {
  const node = project.nodes.find(n => n.id === id)
  if (!node) return err(ErrorCode.VALIDATION_FAILED, `Node not found: ${id}`)

  if (node.parentId === null) {
    return err(ErrorCode.INVALID_HIERARCHY, 'Cannot move the root node')
  }

  const newParent = project.nodes.find(n => n.id === newParentId)
  if (!newParent) {
    return err(ErrorCode.INVALID_HIERARCHY, `Target parent not found: ${newParentId}`)
  }

  // Reject circular reparent: newParentId must not be a descendant of node.
  if (collectDescendants(project.nodes, id).has(newParentId)) {
    return err(ErrorCode.INVALID_HIERARCHY, 'Cannot move a node into its own descendant')
  }

  const isReparent = node.parentId !== newParentId
  const now = new Date().toISOString()
  let next: Project

  if (isReparent) {
    // Sibling name check in new parent.
    if (hasSiblingNameConflict(project.nodes, node.name, newParentId, null)) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        `A node named "${node.name}" already exists in the target location`
      )
    }

    // Remove from old parent, re-number old siblings.
    const withoutNode = project.nodes.filter(n => n.id !== id)
    const reorderedOld = renumberSiblings(withoutNode, node.parentId)

    // Append to new parent as last child.
    const newSiblingCount = reorderedOld.filter(n => n.parentId === newParentId).length
    const movedNode: ManifestNode = {
      ...node,
      parentId: newParentId,
      order: newSiblingCount,
      modified: now,
    }

    next = {
      ...project,
      modified: now,
      nodes: [...reorderedOld, movedNode],
    }
  } else {
    // Reorder within same parent.
    const siblings = project.nodes
      .filter(n => n.parentId === node.parentId)
      .sort((a, b) => a.order - b.order)

    const clamped = Math.max(0, Math.min(newOrder, siblings.length - 1))
    if (clamped === node.order) {
      // No-op: already in position.
      return ok(null)
    }

    // Remove node from current position, insert at target.
    const without = siblings.filter(n => n.id !== id)
    without.splice(clamped, 0, node)

    // Assign clean 0..n-1 orders.
    const reordered = without.map((n, i) => ({ ...n, order: i, modified: now }))

    next = {
      ...project,
      modified: now,
      nodes: [
        ...project.nodes.filter(n => n.parentId !== node.parentId),
        ...reordered,
      ],
    }
  }

  const movedNode = next.nodes.find(n => n.id === id)!
  return ok({ next, label: 'Move node', search: { upsert: [movedNode] } })
}

// ─── Tree helpers ────────────────────────────────────────────────────────────

// Collect id of node + all its descendants.
function collectDescendants(nodes: ManifestNode[], rootId: string): Set<string> {
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    result.add(id)
    for (const n of nodes) {
      if (n.parentId === id) queue.push(n.id)
    }
  }
  return result
}

// Re-assign 0..n-1 order values to siblings of parentId within nodes.
function renumberSiblings(nodes: ManifestNode[], parentId: string | null): ManifestNode[] {
  const siblings = nodes
    .filter(n => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((n, i) => ({ ...n, order: i }))

  const siblingsById = new Map(siblings.map(n => [n.id, n]))
  return nodes.map(n => siblingsById.get(n.id) ?? n)
}

// Case-insensitive sibling name check. excludeId skips self during rename.
function hasSiblingNameConflict(
  nodes: ManifestNode[],
  name: string,
  parentId: string | null,
  excludeId: string | null
): boolean {
  const lower = name.toLowerCase()
  return nodes.some(
    n =>
      n.parentId === parentId &&
      n.id !== excludeId &&
      n.name.toLowerCase() === lower
  )
}

// Build a node's initial property map from its template field defaults.
function seedDefaults(template: NodeTemplate): Record<string, string | number | boolean | null> {
  const props: Record<string, string | number | boolean | null> = {}
  // templateFields() is null-safe against malformed templates.
  for (const [key, field] of Object.entries(templateFields(template))) {
    if (field.default !== undefined && field.default !== null) {
      props[key] = field.default
    }
  }
  return props
}
