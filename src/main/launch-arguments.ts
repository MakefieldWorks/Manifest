import { extname, resolve } from 'path'

export interface LaunchArgumentEnvironment {
  defaultApp: boolean
  appPath: string
}

/**
 * Returns only file/folder arguments intentionally supplied to open in
 * Manifest. Electron's default-app form is `electron <app-path> ...`, so the
 * app path itself must never be interpreted as a project target.
 */
export function collectProjectOpenTargets(
  argv: string[],
  environment: LaunchArgumentEnvironment,
): string[] {
  const firstTargetIndex = environment.defaultApp ? 2 : 1
  return argv.slice(firstTargetIndex).filter((arg) => {
    if (!arg || arg.startsWith('-')) return false
    return !isRuntimeEntrypointArg(arg, environment.appPath)
  })
}

function isRuntimeEntrypointArg(arg: string, appPath: string): boolean {
  const extension = extname(arg)
  if (extension !== '.js' && extension !== '.mjs' && extension !== '.cjs') return false
  return resolve(arg).startsWith(resolve(appPath))
}
