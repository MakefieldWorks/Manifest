// Reference-field integrity: which values may point where, and which
// references would dangle if a set of nodes were deleted. Pure functions of
// the project; callers pass the nodes/templates they are checking against.

import type { ManifestNode, NodeTemplate, Project, ReferenceBlocker, TemplateField } from '../../shared/types'
import { validateReferenceTarget, templateFields, templateLabel } from '../../shared/validation'

export function validateReferenceFieldValue(
  value: unknown,
  field: TemplateField,
  nodes: ManifestNode[],
  selfId?: string | null,
): { valid: boolean; message?: string } {
  if (field.type !== 'reference') return { valid: true }
  return validateReferenceTarget(value, nodes, selfId)
}

export function validateTemplateReferenceDefaults(
  template: NodeTemplate,
  nodes: ManifestNode[],
): { valid: boolean; message?: string } {
  for (const [key, field] of Object.entries(templateFields(template))) {
    if (field.type !== 'reference' || field.default === undefined || field.default === null) {
      continue
    }
    const check = validateReferenceFieldValue(field.default, field, nodes)
    if (!check.valid) {
      return {
        valid: false,
        message: `Field "${key}" default is invalid: ${check.message ?? 'invalid reference'}`,
      }
    }
  }
  return { valid: true }
}

// All incoming references into the deletion set. Returns a serializable shape
// (no node/template objects) so the list can ride in the IPC error context.
// Reports every blocker, not just the first — the renderer needs the full set
// to show what a force-delete would clear.
//
// Detection is gated on the CURRENT `reference` field type, deliberately:
//   - Live node references — a surviving node whose reference-typed property
//     holds an id in the deletion set.
//   - Template defaults — a template `reference` field whose `default` points
//     into the deletion set (would otherwise seed a dangling pointer into
//     every node later created from that template).
// A value left under a key that was rebound away from `reference` (or whose
// template was unbound) is now plain text, NOT a reference, so it is not a
// blocker — clearing arbitrary free-text on force-delete would be silent data
// loss (e.g. a free-text field holding a pasted/imported id).
export function findExternalReferencesTo(project: Project, toDelete: Set<string>): ReferenceBlocker[] {
  const nameById = new Map(project.nodes.map(n => [n.id, n.name]))
  const blockers: ReferenceBlocker[] = []

  for (const node of project.nodes) {
    if (toDelete.has(node.id)) continue
    const templateId = node.templateId ?? null
    const template = templateId ? project.templates?.[templateId] : undefined
    for (const [key, field] of Object.entries(templateFields(template))) {
      if (field.type !== 'reference') continue
      const value = node.properties?.[key]
      if (typeof value === 'string' && toDelete.has(value)) {
        blockers.push({
          kind: 'node',
          nodeId: node.id,
          nodeName: node.name,
          key,
          targetId: value,
          targetName: nameById.get(value) ?? value,
        })
      }
    }
  }

  const templates = project.templates ?? {}
  for (const [templateId, template] of Object.entries(templates)) {
    for (const [key, field] of Object.entries(templateFields(template))) {
      if (field.type !== 'reference') continue
      const def = field.default
      if (typeof def === 'string' && toDelete.has(def)) {
        blockers.push({
          kind: 'template-default',
          nodeId: null,
          nodeName: templateLabel(template, templateId),
          templateId,
          key,
          targetId: def,
          targetName: nameById.get(def) ?? def,
        })
      }
    }
  }

  return blockers
}
