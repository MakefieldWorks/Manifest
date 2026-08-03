import { isAbsolute, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

export interface RendererNavigationEnvironment {
  devServerUrl?: string
  rendererDirectory: string
}

/**
 * Navigation is allowed only within the packaged renderer directory, or on the
 * configured development-server origin. This keeps an untrusted file URL from
 * replacing a renderer page that exposes the preload API.
 */
export function isTrustedRendererNavigationUrl(
  url: string,
  environment: RendererNavigationEnvironment,
): boolean {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'file:') {
      return isPathInsideDirectory(fileURLToPath(parsedUrl), environment.rendererDirectory)
    }

    if (!environment.devServerUrl) return false
    return parsedUrl.origin === new URL(environment.devServerUrl).origin
  } catch {
    return false
  }
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const pathFromDirectory = relative(resolve(directory), resolve(path))
  return pathFromDirectory === '' || (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory))
}
