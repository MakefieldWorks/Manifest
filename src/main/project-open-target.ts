import { readFileSync, statSync } from 'fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'path'
import { err, ok, ErrorCode } from '../shared/errors'
import type { Result } from '../shared/types'
import {
  findProjectDocument,
  isLegacyProjectLauncher,
  LEGACY_PROJECT_DOCUMENT_FILE,
  PROJECT_DOCUMENT_EXTENSION,
} from './project-launcher'

export function resolveProjectOpenTarget(targetPath: string): Result<string> {
  try {
    const stat = statSync(targetPath)

    if (stat.isDirectory()) {
      return validateProjectDirectory(targetPath)
    }

    if (!stat.isFile()) {
      return err(ErrorCode.PROJECT_NOT_FOUND, `Cannot open ${targetPath}: not a project file or folder`)
    }

    if (basename(targetPath) === LEGACY_PROJECT_DOCUMENT_FILE) {
      return validateProjectDirectory(dirname(targetPath))
    }

    if (extname(targetPath) === PROJECT_DOCUMENT_EXTENSION) {
      // New-format documents live in their project folder. Legacy launchers
      // outside that folder retain their old relative/absolute-target behavior.
      if (findProjectDocument(dirname(targetPath))?.path === targetPath && !isLegacyProjectLauncher(targetPath)) {
        return validateProjectDirectory(dirname(targetPath))
      }
      return resolveLegacyProjectLauncher(targetPath)
    }

    return err(
      ErrorCode.PROJECT_NOT_FOUND,
      `Cannot open ${targetPath}: expected a Manifest project folder or .manifestproject file`
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(ErrorCode.PROJECT_NOT_FOUND, `Cannot open ${targetPath}: ${msg}`)
  }
}

function validateProjectDirectory(projectPath: string): Result<string> {
  if (!findProjectDocument(projectPath)) {
    return err(ErrorCode.PROJECT_NOT_FOUND, `Cannot open ${projectPath}: no Manifest project document was found`)
  }
  return ok(projectPath)
}

function resolveLegacyProjectLauncher(launcherPath: string): Result<string> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(launcherPath, 'utf8'))
  } catch {
    return err(ErrorCode.VALIDATION_FAILED, 'Manifest project launcher is not valid JSON')
  }

  if (!raw || typeof raw !== 'object') {
    return err(ErrorCode.VALIDATION_FAILED, 'Manifest project launcher must be a JSON object')
  }

  const projectPath = (raw as { projectPath?: unknown }).projectPath
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    return err(ErrorCode.VALIDATION_FAILED, 'Manifest project launcher must include a projectPath string')
  }

  const resolvedPath = isAbsolute(projectPath)
    ? projectPath
    : resolve(dirname(launcherPath), projectPath)

  return validateProjectDirectory(resolvedPath)
}
