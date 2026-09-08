import { isDeepStrictEqual } from 'node:util'
import type { EditHistoryState, ManifestNode, Project } from '../shared/types'

interface NodeAtPosition { node: ManifestNode; index: number }
interface Edit {
  label: string
  before: NodeAtPosition[]
  after: NodeAtPosition[]
  templates?: { before: Project['templates']; after: Project['templates'] }
  bytes: number
}

function sameNode(a: ManifestNode, b: ManifestNode): boolean {
  if (a === b) return true
  const { modified: _a, ...before } = a
  const { modified: _b, ...after } = b
  return isDeepStrictEqual(before, after)
}

/** Stores changed records, not whole projects. Never persists or touches snapshots. */
export class EditHistory {
  private undoStack: Edit[] = []
  private redoStack: Edit[] = []

  constructor(private readonly maxEntries = 100, private readonly maxBytes = 64 * 1024 * 1024) {}

  state(): EditHistoryState {
    return {
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    }
  }

  clear(): void { this.undoStack = []; this.redoStack = [] }

  prepare(before: Project, after: Project, label: string): Edit | null {
    const oldNodes = new Map(before.nodes.map((node, index) => [node.id, { node, index }]))
    const newNodes = new Map(after.nodes.map((node, index) => [node.id, { node, index }]))
    const ids = new Set([...oldNodes.keys(), ...newNodes.keys()])
    let changed = false
    const edit: Edit = { label, before: [], after: [], bytes: 0 }
    for (const id of ids) {
      const old = oldNodes.get(id)
      const next = newNodes.get(id)
      const different = !old || !next || !sameNode(old.node, next.node)
      changed ||= different
      // Include physical array positions so delete/move undo restores exact order.
      if (different || old?.index !== next?.index) {
        if (old) edit.before.push(old)
        if (next) edit.after.push(next)
      }
    }
    if (!isDeepStrictEqual(before.templates, after.templates)) {
      edit.templates = { before: before.templates, after: after.templates }
      changed = true
    }
    if (!changed) return null // timestamps and object key ordering are not edits
    const captured = structuredClone(edit)
    captured.bytes = Buffer.byteLength(JSON.stringify(captured), 'utf8')
    return captured
  }

  record(edit: Edit): void {
    this.redoStack = []
    this.undoStack.push(edit)
    let bytes = this.undoStack.reduce((sum, entry) => sum + entry.bytes, 0)
    // Always retain the latest operation, including a single large import.
    while (this.undoStack.length > 1 && (this.undoStack.length > this.maxEntries || bytes > this.maxBytes)) {
      bytes -= this.undoStack.shift()!.bytes
    }
  }

  preview(project: Project, direction: 'undo' | 'redo'): Project | null {
    const edit = (direction === 'undo' ? this.undoStack : this.redoStack).at(-1)
    if (!edit) return null
    const affected = new Set([...edit.before, ...edit.after].map(entry => entry.node.id))
    const unchanged = project.nodes.filter(node => !affected.has(node.id))
    const target = direction === 'undo' ? edit.before : edit.after
    const positions = new Map(target.map(entry => [entry.index, entry.node]))
    const nodes: ManifestNode[] = []
    let nextUnchanged = 0
    for (let index = 0; index < unchanged.length + target.length; index++) {
      const restored = positions.get(index)
      nodes.push(restored ? structuredClone(restored) : unchanged[nextUnchanged++])
    }
    const result: Project = { ...project, nodes, modified: new Date().toISOString() }
    if (edit.templates) {
      const templates = direction === 'undo' ? edit.templates.before : edit.templates.after
      if (templates === undefined) delete result.templates
      else result.templates = structuredClone(templates)
    }
    return result
  }

  /** Advance only after the project and search index accepted the transition. */
  accept(direction: 'undo' | 'redo'): void {
    const source = direction === 'undo' ? this.undoStack : this.redoStack
    const destination = direction === 'undo' ? this.redoStack : this.undoStack
    const edit = source.pop()
    if (edit) destination.push(edit)
  }
}
