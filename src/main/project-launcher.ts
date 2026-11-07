import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * The user-facing Layertrail project document. Its JSON encoding stays readable,
 * while the dedicated extension ensures desktop file associations are unambiguous.
 */
export const PROJECT_DOCUMENT_FILE = 'Layertrail.layertrail'
export const PROJECT_DOCUMENT_EXTENSION = '.layertrail'

/**
 * The document name used while the app was called Manifest (through
 * 0.1.0-alpha.1). Opening such a project renames it to PROJECT_DOCUMENT_FILE.
 * The same name was also used by tiny legacy launchers; see below.
 */
export const PREVIOUS_PROJECT_DOCUMENT_FILE = 'Manifest.manifestproject'
export const PREVIOUS_PROJECT_DOCUMENT_EXTENSION = '.manifestproject'

/** Projects created before the dedicated document extension was introduced. */
export const LEGACY_PROJECT_DOCUMENT_FILE = 'manifest.json'

/**
 * Older document names, newest first. Git history keeps them in old commits,
 * so reading a snapshot falls back through this list.
 */
export const OLDER_PROJECT_DOCUMENT_FILES = [PREVIOUS_PROJECT_DOCUMENT_FILE, LEGACY_PROJECT_DOCUMENT_FILE] as const
/** Legacy launchers are tiny JSON pointers, never project documents. */
export const MAX_LEGACY_LAUNCHER_BYTES = 4 * 1024

export interface ProjectDocumentLocation {
  path: string
  /** True when the document still has an older name and is renamed on open. */
  isLegacy: boolean
  /**
   * Older-name files to delete once the document has been written under
   * PROJECT_DOCUMENT_FILE: the document itself and any stale legacy launcher.
   */
  supersededPaths: string[]
}

/**
 * Finds the source-of-truth document for a project folder.
 *
 * Lookup order: Layertrail.layertrail, then Manifest.manifestproject, then
 * manifest.json. The oldest projects contain both manifest.json and a tiny
 * Manifest.manifestproject launcher. Detect that launcher so it cannot shadow
 * the real legacy document during migration. A malformed current-format
 * document is intentionally treated as canonical: opening it should surface a
 * validation error, not look like a missing project.
 */
export function findProjectDocument(projectPath: string): ProjectDocumentLocation | null {
  const documentPath = join(projectPath, PROJECT_DOCUMENT_FILE)
  const previousPath = join(projectPath, PREVIOUS_PROJECT_DOCUMENT_FILE)
  const legacyPath = join(projectPath, LEGACY_PROJECT_DOCUMENT_FILE)

  if (existsSync(documentPath)) return { path: documentPath, isLegacy: false, supersededPaths: [] }
  const hasPrevious = existsSync(previousPath)
  const hasLegacy = existsSync(legacyPath)
  if (hasPrevious && !(hasLegacy && isLegacyProjectLauncher(previousPath))) {
    return { path: previousPath, isLegacy: true, supersededPaths: [previousPath] }
  }
  if (hasLegacy) {
    return { path: legacyPath, isLegacy: true, supersededPaths: hasPrevious ? [legacyPath, previousPath] : [legacyPath] }
  }
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
