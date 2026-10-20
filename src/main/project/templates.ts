// Template CRUD planners. Same contract as ./nodes: validate against the
// current project and return the next project as a ProjectMutation. Template
// changes can retype any bound node, so they always request a full search
// rebuild rather than per-node upserts.

import type { NodeTemplate, Project, Result } from '../../shared/types'
import { ok, err, ErrorCode } from '../../shared/errors'
import { validateTemplate, validateTemplateId, validateTypedPropertyValue } from '../../shared/validation'
import { validateReferenceFieldValue, validateTemplateReferenceDefaults } from './references'
import type { ProjectMutation } from './mutation'

// Create a new node template. id must be a unique slug.
export function planTemplateCreate(project: Project, id: string, template: NodeTemplate): Result<ProjectMutation> {
  const idValidation = validateTemplateId(id)
  if (!idValidation.valid) {
    return err(ErrorCode.VALIDATION_FAILED, idValidation.message ?? 'Invalid template id')
  }
  if (project.templates?.[id]) {
    return err(ErrorCode.VALIDATION_FAILED, `A template with id "${id}" already exists`)
  }
  const templateValidation = validateTemplate(template)
  if (!templateValidation.valid) {
    return err(ErrorCode.VALIDATION_FAILED, templateValidation.message ?? 'Invalid template')
  }
  const referenceDefaults = validateTemplateReferenceDefaults(template, project.nodes)
  if (!referenceDefaults.valid) {
    return err(ErrorCode.VALIDATION_FAILED, referenceDefaults.message ?? 'Invalid reference default')
  }

  const next: Project = {
    ...project,
    modified: new Date().toISOString(),
    templates: { ...project.templates, [id]: template },
  }
  return ok({ next, label: 'Create template', search: { rebuild: true } })
}

// Update an existing template. Rejects changes that would make any currently
// bound node's value invalid (we never retroactively coerce stored data).
export function planTemplateUpdate(project: Project, id: string, changes: Partial<NodeTemplate>): Result<ProjectMutation> {
  const existing = project.templates?.[id]
  if (!existing) return err(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${id}`)

  const proposed: NodeTemplate = {
    label: changes.label ?? existing.label,
    ...(changes.description !== undefined
      ? { description: changes.description }
      : existing.description !== undefined
        ? { description: existing.description }
        : {}),
    fields: changes.fields ?? existing.fields,
  }

  const templateValidation = validateTemplate(proposed)
  if (!templateValidation.valid) {
    return err(ErrorCode.VALIDATION_FAILED, templateValidation.message ?? 'Invalid template')
  }
  const referenceDefaults = validateTemplateReferenceDefaults(proposed, project.nodes)
  if (!referenceDefaults.valid) {
    return err(ErrorCode.VALIDATION_FAILED, referenceDefaults.message ?? 'Invalid reference default')
  }

  // Guard: every bound node's existing values must remain valid under the
  // proposed field definitions. A field that is removed is fine (the value
  // simply becomes ad-hoc/untyped).
  for (const node of project.nodes) {
    if ((node.templateId ?? null) !== id) continue
    for (const [key, field] of Object.entries(proposed.fields)) {
      const value = node.properties[key]
      // An empty string is the freeform-editor representation of an unset
      // value. Treat it the same as a missing typed field so a user can set
      // its type before entering a value (notably for dates and numbers).
      if (value === undefined || value === null || value === '') continue
      const check = validateTypedPropertyValue(value, field)
      if (!check.valid) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          `Cannot change field "${key}": node "${node.name}" has value ${JSON.stringify(value)} that is invalid for the new type (${check.message})`
        )
      }
      const targetCheck = validateReferenceFieldValue(value, field, project.nodes, node.id)
      if (!targetCheck.valid) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          `Cannot change field "${key}": node "${node.name}" has value ${JSON.stringify(value)} that is invalid for the new type (${targetCheck.message})`
        )
      }
    }
  }

  const next: Project = {
    ...project,
    modified: new Date().toISOString(),
    templates: { ...project.templates, [id]: proposed },
  }
  return ok({ next, label: 'Edit template', search: { rebuild: true } })
}

// Delete a template. Bound nodes are unbound (templateId cleared) but keep
// their property values — non-destructive; values become ad-hoc/untyped.
export function planTemplateDelete(project: Project, id: string): Result<ProjectMutation> {
  if (!project.templates?.[id]) {
    return err(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${id}`)
  }

  const remaining = { ...project.templates }
  delete remaining[id]

  const now = new Date().toISOString()
  const next: Project = {
    ...project,
    modified: now,
    templates: remaining,
    nodes: project.nodes.map(n =>
      (n.templateId ?? null) === id ? { ...n, templateId: null, modified: now } : n
    ),
  }
  return ok({ next, label: 'Delete template', search: { rebuild: true } })
}
