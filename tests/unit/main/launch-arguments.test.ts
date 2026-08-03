import { describe, expect, it } from 'vitest'
import { collectProjectOpenTargets } from '../../../src/main/launch-arguments'

const appPath = '/Applications/Manifest.app'

describe('collectProjectOpenTargets', () => {
  it('does not treat the default Electron app path as a project target', () => {
    expect(collectProjectOpenTargets(['/usr/local/bin/electron', '.'], {
      defaultApp: true,
      appPath,
    })).toEqual([])
  })

  it('keeps a project target passed after the default Electron app path', () => {
    expect(collectProjectOpenTargets([
      '/usr/local/bin/electron',
      '/Users/robert/Code/Manifest/out/main/index.js',
      '/Users/robert/Documents/Network Lab',
    ], {
      defaultApp: true,
      appPath: '/Users/robert/Code/Manifest',
    })).toEqual(['/Users/robert/Documents/Network Lab'])
  })

  it('keeps a project target for a packaged application while ignoring flags', () => {
    expect(collectProjectOpenTargets([
      '/Applications/Manifest.app/Contents/MacOS/Manifest',
      '--user-data-dir=/tmp/manifest',
      '/Users/robert/Documents/Network Lab',
    ], {
      defaultApp: false,
      appPath,
    })).toEqual(['/Users/robert/Documents/Network Lab'])
  })

  it('does not discard later open targets that happen to look like scripts', () => {
    expect(collectProjectOpenTargets([
      '/Applications/Manifest.app/Contents/MacOS/Manifest',
      '/Applications/Manifest.app/Contents/Resources/app.asar/out/main/index.js',
      '/Applications/Manifest.app/Contents/Resources/example.js',
    ], {
      defaultApp: false,
      appPath,
    })).toEqual(['/Applications/Manifest.app/Contents/Resources/example.js'])
  })
})
