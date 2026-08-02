import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * The user-facing Manifest project document. Its JSON encoding stays readable,
 * while the dedicated extension ensures desktop file associations are unambiguous.
 */
export const PROJECT_DOCUMENT_FILE = 'Manifest.manifestproject'
export const PROJECT_DOCUMENT_EXTENSION = '.manifestproject'

/** Projects created before the dedicated document extension was introduced. */
export const LEGACY_PROJECT_DOCUMENT_FILE = 'manifest.json'
/** Legacy launchers are tiny JSON pointers, never project documents. */
export const MAX_LEGACY_LAUNCHER_BYTES = 4 * 1024

export interface ProjectDocumentLocation {
  path: string
  isLegacy: boolean
}

/**
 * Finds the source-of-truth document for a project folder.
 *
 * Older projects contain both manifest.json and a tiny Manifest.manifestproject
 * launcher. Detect that launcher so it cannot shadow the real legacy document
 * during migration. A malformed new-format document is intentionally treated as
 * canonical: opening it should surface a validation error, not look like a
 * missing project.
 */
export function findProjectDocument(projectPath: string): ProjectDocumentLocation | null {
  const documentPath = join(projectPath, PROJECT_DOCUMENT_FILE)
  const legacyPath = join(projectPath, LEGACY_PROJECT_DOCUMENT_FILE)

  if (existsSync(documentPath) && !(existsSync(legacyPath) && isLegacyProjectLauncher(documentPath))) {
    return { path: documentPath, isLegacy: false }
  }
  if (existsSync(legacyPath)) return { path: legacyPath, isLegacy: true }
  return null
}

/** A legacy launcher pointed to a project folder instead of containing project data. */
export function isLegacyProjectLauncher(filePath: string): boolean {
  try {
    // Legacy launchers contain only a version and projectPath. Never parse a
    // full project document merely to distinguish that obsolete format.
    if (statSync(filePath).size > MAX_LEGACY_LAUNCHER_BYTES) return false
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!raw || typeof raw !== 'object') return false
    const candidate = raw as { projectPath?: unknown; nodes?: unknown }
    return typeof candidate.projectPath === 'string' && !Array.isArray(candidate.nodes)
  } catch {
    return false
  }
}
