import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'

/**
 * The app was called Manifest through 0.1.0-alpha.1. Electron derives the
 * per-user settings folder from the product name, so the rename to Layertrail
 * moves it (for example ~/Library/Application Support/Manifest becomes
 * .../Layertrail). These are the small settings files worth carrying over.
 * Logs stay behind.
 */
export const PREVIOUS_USER_DATA_FOLDER = 'Manifest'
export const MIGRATED_USER_DATA_FILES = ['recent-projects.json', 'app-settings.json'] as const

/**
 * Copies settings from the pre-rename folder into the current one, once.
 * A file is copied only when the current folder lacks it, so nothing the new
 * app already wrote is overwritten and later launches do nothing. Runs only for
 * the default location: a custom --user-data-dir (tests, portable setups) never
 * picks up the user's real settings. Returns the files that were copied.
 */
export function migratePreviousUserData(userData: string, appData: string): string[] {
  if (dirname(userData) !== appData || basename(userData) === PREVIOUS_USER_DATA_FOLDER) return []
  const previous = join(appData, PREVIOUS_USER_DATA_FOLDER)
  if (!existsSync(previous)) return []
  const copied: string[] = []
  for (const file of MIGRATED_USER_DATA_FILES) {
    const source = join(previous, file)
    const target = join(userData, file)
    if (!existsSync(source) || existsSync(target)) continue
    try {
      mkdirSync(userData, { recursive: true })
      copyFileSync(source, target)
      copied.push(file)
    } catch {
      // Best effort: the app works with default settings and an empty
      // Recent list, so a failed copy must never block startup.
    }
  }
  return copied
}
