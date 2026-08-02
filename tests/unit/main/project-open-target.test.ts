import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveProjectOpenTarget } from '../../../src/main/project-open-target'
import { isLegacyProjectLauncher } from '../../../src/main/project-launcher'

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `manifest-open-target-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

function writeProject(name = 'Lab'): string {
  const projectDir = join(tmpDir, name)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'Manifest.manifestproject'), '{}', 'utf8')
  return projectDir
}

function writeLegacyProject(name = 'Legacy Lab'): string {
  const projectDir = join(tmpDir, name)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'manifest.json'), '{}', 'utf8')
  return projectDir
}

describe('resolveProjectOpenTarget', () => {
  it('accepts a project directory containing Manifest.manifestproject', () => {
    const projectDir = writeProject()

    const result = resolveProjectOpenTarget(projectDir)

    expect(result).toEqual({ ok: true, data: projectDir })
  })

  it('accepts a Manifest.manifestproject file and resolves to its project directory', () => {
    const projectDir = writeProject()

    const result = resolveProjectOpenTarget(join(projectDir, 'Manifest.manifestproject'))

    expect(result).toEqual({ ok: true, data: projectDir })
  })

  it('continues to accept a legacy manifest.json file for migration', () => {
    const projectDir = writeLegacyProject()

    const result = resolveProjectOpenTarget(join(projectDir, 'manifest.json'))

    expect(result).toEqual({ ok: true, data: projectDir })
  })

  it('accepts a .manifestproject launcher with a relative projectPath', () => {
    const projectDir = writeLegacyProject('Relative Lab')
    const launcher = join(projectDir, 'Manifest.manifestproject')
    writeFileSync(launcher, JSON.stringify({ version: 1, projectPath: '.' }), 'utf8')

    const result = resolveProjectOpenTarget(launcher)

    expect(result).toEqual({ ok: true, data: projectDir })
  })

  it('accepts a .manifestproject launcher with an absolute projectPath', () => {
    const projectDir = writeLegacyProject('Absolute Lab')
    const launcher = join(tmpDir, 'Absolute.manifestproject')
    writeFileSync(launcher, JSON.stringify({ version: 1, projectPath: projectDir }), 'utf8')

    const result = resolveProjectOpenTarget(launcher)

    expect(result).toEqual({ ok: true, data: projectDir })
  })

  it('does not parse oversized project documents as legacy launchers', () => {
    const documentPath = join(tmpDir, 'Large.manifestproject')
    writeFileSync(documentPath, JSON.stringify({ projectPath: '.', filler: 'x'.repeat(5_000) }), 'utf8')

    expect(isLegacyProjectLauncher(documentPath)).toBe(false)
  })

  it('rejects unsupported files', () => {
    const path = join(tmpDir, 'notes.txt')
    writeFileSync(path, 'not a project', 'utf8')

    const result = resolveProjectOpenTarget(path)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('legacy manifest.json file')
  })

  it('rejects an existing folder that is not a Manifest project', () => {
    const folder = join(tmpDir, 'Not A Project')
    mkdirSync(folder)

    const result = resolveProjectOpenTarget(folder)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('no Manifest project document was found')
  })

  it('rejects malformed launchers', () => {
    const launcher = join(tmpDir, 'Broken.manifestproject')
    writeFileSync(launcher, '{', 'utf8')

    const result = resolveProjectOpenTarget(launcher)

    expect(result.ok).toBe(false)
  })
})
