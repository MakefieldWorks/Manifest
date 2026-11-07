import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveProjectOpenTarget } from '../../../src/main/project-open-target'

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `layertrail-open-target-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

function writeProject(name = 'Lab'): string {
  const projectDir = join(tmpDir, name)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'Layertrail.layertrail'), '{}', 'utf8')
  return projectDir
}

describe('resolveProjectOpenTarget', () => {
  it('accepts a project directory containing Layertrail.layertrail', () => {
    const projectDir = writeProject()

    expect(resolveProjectOpenTarget(projectDir)).toEqual({ ok: true, data: projectDir })
  })

  it('accepts a Layertrail.layertrail file and resolves to its project directory', () => {
    const projectDir = writeProject()

    expect(resolveProjectOpenTarget(join(projectDir, 'Layertrail.layertrail'))).toEqual({ ok: true, data: projectDir })
  })

  it('rejects a .layertrail file that is not its folder\'s project document', () => {
    const projectDir = writeProject('Copied Lab')
    const copy = join(projectDir, 'Copy.layertrail')
    writeFileSync(copy, '{}', 'utf8')

    const result = resolveProjectOpenTarget(copy)

    expect(result.ok).toBe(false)
  })

  it('rejects unsupported files', () => {
    const path = join(tmpDir, 'notes.txt')
    writeFileSync(path, 'not a project', 'utf8')

    const result = resolveProjectOpenTarget(path)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('expected a Layertrail project folder or .layertrail file')
  })

  it('rejects an existing folder that is not a Layertrail project', () => {
    const folder = join(tmpDir, 'Not A Project')
    mkdirSync(folder)

    const result = resolveProjectOpenTarget(folder)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('no Layertrail project document was found')
  })

  it('rejects a missing path', () => {
    expect(resolveProjectOpenTarget(join(tmpDir, 'missing')).ok).toBe(false)
  })
})
