// Confirmation text for deleting a node. Kept pure so the pluralization and
// the reference-blocker list can be unit tested.

import type { ReferenceBlocker } from '../../../shared/types'

/** Prompt shown before deleting a node that has descendants. */
export function deleteSubtreeConfirmMessage(nodeName: string, descendantCount: number): string {
  return `Delete "${nodeName}" and its ${descendantCount} descendant${descendantCount === 1 ? '' : 's'}?`
}

/**
 * Read the blockers from a refused delete. The error context crosses the IPC
 * boundary as unknown, so anything other than an array means "no blockers".
 */
export function referenceBlockersFromContext(context: Record<string, unknown> | undefined): ReferenceBlocker[] {
  const rawBlockers = context?.blockers
  return Array.isArray(rawBlockers) ? (rawBlockers as ReferenceBlocker[]) : []
}

/** Prompt offering to clear incoming references and force the delete. */
export function referenceBlockersConfirmMessage(nodeName: string, blockers: ReferenceBlocker[]): string {
  const list = blockers
    .map(b => {
      const holder = b.kind === 'template-default' ? `Template "${b.nodeName}" default` : b.nodeName
      return `• ${holder} → ${b.key} (→ ${b.targetName})`
    })
    .join('\n')
  // A holder may contribute more than one blocker (multiple reference keys),
  // and template defaults aren't nodes, so this counts references, not nodes.
  const n = blockers.length
  const ref = `reference${n === 1 ? '' : 's'}`
  return `"${nodeName}" has ${n} incoming ${ref}:\n\n${list}\n\n` +
    `Delete "${nodeName}" and clear ${n === 1 ? 'it' : `all ${n}`}?`
}
