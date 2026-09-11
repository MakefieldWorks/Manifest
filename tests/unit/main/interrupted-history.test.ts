import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProjectManager } from '../../../src/main/project-manager'
import { GitService } from '../../../src/main/git-service'
import { HistoryOperationStore } from '../../../src/main/history-operation'
import { PROJECT_DOCUMENT_FILE } from '../../../src/main/project-launcher'

const logger = { error() {}, warn() {}, info() {}, debug() {} }
let root: string
let path: string
let manager: ProjectManager
let git: GitService
let store: HistoryOperationStore
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'manifest-interrupted-'))
  git = new GitService(logger as any)
  manager = new ProjectManager(git, logger as any)
  const created = await manager.createProject('Interruption Lab', root)
  if (!created.ok) throw new Error(created.error.message)
  path = created.data.path!
  store = new HistoryOperationStore(path, created.data.id)
  expect((await manager.snapshotCreate('baseline')).ok).toBe(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  manager.discardCurrentProject()
  rmSync(root, { recursive: true, force: true })
})
function review() {
  const result = manager.reviewInterruptedHistory()
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
function failHistoryWrite() {
  return vi.spyOn(manager as any, 'writeSnapshotHistory').mockImplementation(() => { throw new Error('Injected history write failure') })
}

describe('interrupted history operations', () => {
  it('cleans temporary evidence after success', () => {
    expect(store.pending()).toBe(false)
    expect(readdirSync(store.recoveryPath)).toEqual([])
  })

  it('reports a pre-journal failure without offering an unfinished operation', async () => {
    vi.spyOn(git, 'listSnapshots').mockRejectedValueOnce(new Error('Injected list failure'))
    expect(await manager.snapshotCreate('not-started')).toMatchObject({
      ok: false,
      error: { code: 'HISTORY_OPERATION_FAILED', message: expect.stringContaining('before any journaled change') },
    })
    expect(store.pending()).toBe(false)
    expect(manager.interruptedHistoryStatus()).toEqual({ ok: true, data: { pending: false } })
  })

  it('rejects save, close, and project switches while a journaled operation is in flight', async () => {
    let release!: () => void
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const original = git.createSnapshot.bind(git)
    vi.spyOn(git, 'createSnapshot').mockImplementation(async (...args) => {
      entered()
      await held
      return original(...args)
    })
    const operation = manager.snapshotCreate('held')
    await ready
    try {
      expect((await manager.saveProject()).ok).toBe(false)
      expect((await manager.flushAndClose()).ok).toBe(false)
      expect((await manager.openProject(path)).ok).toBe(false)
      expect((await manager.createProject('Other Lab', root)).ok).toBe(false)
      expect(manager.interruptedHistoryStatus()).toEqual({ ok: true, data: { pending: false } })
    } finally { release() }
    expect((await operation).ok).toBe(true)
  })

  it.each(['snapshot', 'revert', 'recover'] as const)('detects unfinished %s after reopen and preserves both inventories when acknowledged', async operation => {
    manager.nodeCreate(manager.getCurrent()!.nodes[0].id, 'Earlier unsaved rack')
    let recoveryId = ''
    if (operation === 'recover') {
      const reverted = await manager.snapshotRevert({ name: 'baseline' })
      if (!reverted.ok || !reverted.data.safetyRecoveryPoint) throw new Error('Missing recovery fixture')
      recoveryId = reverted.data.safetyRecoveryPoint.id
    }
    const beforeCount = manager.getCurrent()!.nodes.length
    const write = failHistoryWrite()
    const result = operation === 'snapshot' ? await manager.snapshotCreate('unfinished') : operation === 'revert' ?
      await manager.snapshotRevert({ name: 'baseline' }) : await manager.recoveryPointApply({ id: recoveryId })
    expect(result.ok).toBe(false)
    expect(store.pending()).toBe(true)
    expect(JSON.parse(store.candidate().inventory.toString()).nodes).toHaveLength(beforeCount)
    write.mockRestore()
    manager.discardCurrentProject()
    manager = new ProjectManager(git, logger as any)
    expect((await manager.openProject(path)).ok).toBe(true)
    expect(manager.interruptedHistoryStatus()).toEqual({ ok: true, data: { pending: true } })
    const diskBefore = readFileSync(join(path, PROJECT_DOCUMENT_FILE))
    expect((await manager.saveProject()).ok).toBe(false)
    expect(manager.nodeCreate(manager.getCurrent()!.nodes[0].id, 'Blocked').ok).toBe(false)
    expect(manager.undo().ok).toBe(false)
    expect((await manager.snapshotCreate('blocked')).ok).toBe(false)
    expect((await manager.exportProjectArchive(join(root, 'blocked.manifestarchive'))).ok).toBe(false)
    const preview = review()
    expect(preview.beforeNodeCount).toBe(beforeCount)
    expect(readFileSync(join(path, PROJECT_DOCUMENT_FILE))).toEqual(diskBefore)
    const snapshotIds = (await git.listSnapshots(path)).map(snapshot => snapshot.id)
    const continued = await manager.acknowledgeInterruptedHistory({ token: preview.token })
    expect(continued.ok).toBe(true)
    expect(store.pending()).toBe(false)
    expect(existsSync(preview.recoveryPath)).toBe(true)
    expect((await git.listSnapshots(path)).map(snapshot => snapshot.id)).toEqual(snapshotIds)
    const history = JSON.parse(readFileSync(join(path, '.manifest', 'history.json'), 'utf8'))
    expect(history.currentBaseSnapshotId).toBeNull()
    expect(history.pendingRevertEventId).toBeNull()
    expect(readdirSync(store.recoveryPath).some(name => name.endsWith('-continued.manifest.json'))).toBe(true)
    expect((await manager.snapshotCreate('resumed')).ok).toBe(true)
  })

  it('retains the marker if final cleanup fails after the history commit', async () => {
    const finish = vi.spyOn(HistoryOperationStore.prototype, 'finish').mockImplementation(() => { throw new Error('Interrupted cleanup') })
    expect((await manager.snapshotCreate('committed')).ok).toBe(true)
    expect(store.pending()).toBe(true)
    finish.mockRestore()
    expect((await manager.acknowledgeInterruptedHistory({ token: review().token })).ok).toBe(true)
    expect((await git.listSnapshots(path)).filter(snapshot => snapshot.id === 'committed')).toHaveLength(1)
    const history = JSON.parse(readFileSync(join(path, '.manifest', 'history.json'), 'utf8'))
    expect(history.events.filter((event: any) => event.snapshotId === 'committed')).toHaveLength(1)
  })

  it('retains pending evidence when acknowledgement fails, then supports a fresh retry', async () => {
    const write = failHistoryWrite()
    await manager.snapshotCreate('unfinished')
    expect((await manager.acknowledgeInterruptedHistory({ token: review().token })).ok).toBe(false)
    expect(store.pending()).toBe(true)
    write.mockRestore()
    expect((await manager.acknowledgeInterruptedHistory({ token: review().token })).ok).toBe(true)
  })

  it('clears evidence without resetting lineage when a document write safely fails before Git changes', async () => {
    const historyBefore = readFileSync(join(path, '.manifest', 'history.json'))
    const write = vi.spyOn(manager as any, 'writeManifest').mockResolvedValue({ ok: false, error: { code: 'AUTOSAVE_WRITE_FAILED', message: 'Injected save failure' } })
    expect((await manager.snapshotCreate('not-created')).ok).toBe(false)
    write.mockRestore()
    expect(store.pending()).toBe(false)
    expect(readFileSync(join(path, '.manifest', 'history.json'))).toEqual(historyBefore)
    expect((await git.listSnapshots(path)).map(snapshot => snapshot.id)).toEqual(['baseline'])
  })

  it('clears evidence after a failed search rebuild rolls back the revert', async () => {
    manager.nodeCreate(manager.getCurrent()!.nodes[0].id, 'Still current')
    const current = structuredClone(manager.getCurrent())
    const history = readFileSync(join(path, '.manifest', 'history.json'))
    vi.spyOn(manager as any, 'rebuildSearchIndex').mockReturnValueOnce({ ok: false, error: { code: 'SQLITE_CAPABILITY', message: 'Injected index failure' } })
    expect((await manager.snapshotRevert({ name: 'baseline' })).ok).toBe(false)
    expect(store.pending()).toBe(false)
    expect(manager.getCurrent()).toEqual(current)
    expect(readFileSync(join(path, '.manifest', 'history.json'))).toEqual(history)
    expect((manager as any).search.query(path, 'Still')).toHaveLength(1)
  })

  it('resolves an outside document change while an unfinished operation remains pending', async () => {
    const write = failHistoryWrite()
    await manager.snapshotCreate('unfinished')
    write.mockRestore()
    const file = join(path, PROJECT_DOCUMENT_FILE)
    const outside = JSON.parse(readFileSync(file, 'utf8'))
    outside.nodes[0].name = 'Outside inventory'
    writeFileSync(file, JSON.stringify(outside))
    manager.checkExternalDocument()
    const external = manager.reviewExternalDocument()
    if (!external.ok) throw new Error(external.error.message)
    expect((await manager.resolveExternalDocument({ token: external.data.token, choice: 'keep-local' })).ok).toBe(true)
    expect(store.pending()).toBe(true)
    expect((await manager.acknowledgeInterruptedHistory({ token: review().token })).ok).toBe(true)
  })

  it('rejects stale previews and altered evidence without clearing the pending record', async () => {
    const write = failHistoryWrite()
    await manager.snapshotCreate('unfinished')
    write.mockRestore()
    const token = review().token
    const historyPath = join(path, '.manifest', 'history.json')
    const history = JSON.parse(readFileSync(historyPath, 'utf8'))
    history.currentBaseSnapshotId = null
    writeFileSync(historyPath, JSON.stringify(history))
    expect((await manager.acknowledgeInterruptedHistory({ token })).ok).toBe(false)
    const inventoryPath = review().recoveryPath
    writeFileSync(inventoryPath, '{}')
    expect(manager.reviewInterruptedHistory().ok).toBe(false)
    expect(store.pending()).toBe(true)
  })

  it.each(['{broken', '{"version":999}'])('blocks invalid evidence without rewriting it: %s', async bytes => {
    writeFileSync(store.pendingPath, bytes)
    expect(manager.reviewInterruptedHistory().ok).toBe(false)
    expect((await manager.saveProject()).ok).toBe(false)
    expect(readFileSync(store.pendingPath, 'utf8')).toBe(bytes)
  })
})
