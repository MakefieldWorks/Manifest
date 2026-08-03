import { describe, expect, it } from 'vitest'
import { isTrustedRendererNavigationUrl } from '../../../src/main/renderer-navigation'

const rendererDirectory = '/Applications/Manifest.app/Contents/Resources/app.asar/out/renderer'

describe('isTrustedRendererNavigationUrl', () => {
  it('allows packaged renderer resources but rejects other local files', () => {
    expect(isTrustedRendererNavigationUrl(
      'file:///Applications/Manifest.app/Contents/Resources/app.asar/out/renderer/index.html',
      { rendererDirectory },
    )).toBe(true)
    expect(isTrustedRendererNavigationUrl('file:///tmp/untrusted.html', { rendererDirectory })).toBe(false)
  })

  it('allows only the configured development-server origin', () => {
    const environment = { rendererDirectory, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererNavigationUrl('http://localhost:5173/?settings=1', environment)).toBe(true)
    expect(isTrustedRendererNavigationUrl('http://localhost:4173', environment)).toBe(false)
  })
})
