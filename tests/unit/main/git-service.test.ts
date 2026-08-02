// Git service tests use real git repos in temp directories, never mocks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { GitService } from '../../../src/main/git-service'

const noopLogger = { error() {}, warn() {}, info() {}, debug() {} } as any

let tmpDir: string
let git: GitService

beforeEach(() => {
  tmpDir = join(tmpdir(), `manifest-git-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  git = new GitService(noopLogger)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

function runGit(args: string[]) {
  execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' })
}

// Build a Manifest.manifestproject string larger than Node's default 1 MB execFile buffer,
// so we exercise the maxBuffer path in readSnapshotManifest / readHeadManifest.
function largeManifestJson(): string {
  const nodes = Array.from({ length: 6000 }, (_, i) => ({
    id: `node-${i}`,
    parentId: i === 0 ? null : 'node-0',
    name: `Component ${i}`,
    order: i,
    properties: { serial: `SN-${i}`, note: 'x'.repeat(40) },
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
  }))
  return JSON.stringify({ version: 3, id: 'big', name: 'Big', nodes, templates: {} }, null, 2)
}

describe('GitService — large manifests exceed the default execFile buffer', () => {
  it('reads a snapshot/head manifest larger than 1 MB without ENOBUFS', async () => {
    const json = largeManifestJson()
    expect(json.length).toBeGreaterThan(1024 * 1024) // > 1 MB

    writeFileSync(join(tmpDir, 'Manifest.manifestproject'), json, 'utf8')
    runGit(['init'])
    runGit(['add', 'Manifest.manifestproject'])
    runGit(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'big'])
    runGit(['tag', 'snapshot/big-snap'])

    const fromTag = await git.readSnapshotManifest(tmpDir, 'big-snap')
    expect(fromTag.length).toBe(json.length)

    const fromHead = await git.readHeadManifest(tmpDir)
    expect(fromHead.length).toBe(json.length)
  })

  it('reads snapshots created before the dedicated document extension', async () => {
    const legacy = JSON.stringify({ version: 3, id: 'legacy', name: 'Legacy', nodes: [] }, null, 2)
    writeFileSync(join(tmpDir, 'manifest.json'), legacy, 'utf8')
    runGit(['init'])
    runGit(['add', 'manifest.json'])
    runGit(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'legacy'])
    runGit(['tag', 'snapshot/legacy-snap'])

    await expect(git.readSnapshotManifest(tmpDir, 'legacy-snap')).resolves.toBe(legacy)
    await expect(git.readHeadManifest(tmpDir)).resolves.toBe(legacy)
  })

  it('records the legacy-to-document rename in the next snapshot', async () => {
    const legacy = JSON.stringify({ version: 3, id: 'legacy', name: 'Legacy', nodes: [] }, null, 2)
    const migrated = JSON.stringify({ version: 3, id: 'legacy', name: 'Migrated', nodes: [] }, null, 2)
    writeFileSync(join(tmpDir, 'manifest.json'), legacy, 'utf8')
    runGit(['init'])
    runGit(['add', 'manifest.json'])
    runGit(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'legacy'])
    runGit(['tag', 'snapshot/legacy-snap'])

    writeFileSync(join(tmpDir, 'Manifest.manifestproject'), migrated, 'utf8')
    unlinkSync(join(tmpDir, 'manifest.json'))
    await git.createSnapshot(tmpDir, 'migrated-snap')

    await expect(git.readSnapshotManifest(tmpDir, 'legacy-snap')).resolves.toBe(legacy)
    await expect(git.readSnapshotManifest(tmpDir, 'migrated-snap')).resolves.toBe(migrated)
  })
})
