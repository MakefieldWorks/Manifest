import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { writeHistoryFile } from './history-backup'

const LIMIT = 50 * 1024 * 1024
export interface PendingHistoryOperation {
  version: 1
  id: string
  projectId: string
  label: string
  startedAt: string
  inventoryFile: string
  historyFile: string
  inventoryHash: string
  historyHash: string
}

/** Durable evidence, not a transaction or a request to replay Git commands. */
export class HistoryOperationStore {
  readonly pendingPath: string
  readonly recoveryPath: string
  constructor(private readonly projectPath: string, private readonly projectId: string) {
    this.pendingPath = join(projectPath, '.manifest', 'history-operation.json')
    this.recoveryPath = join(projectPath, '.manifest', 'recovery')
  }

  pending(): boolean {
    try { lstatSync(this.pendingPath); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      // Unreadable evidence is still pending; never silently unblock writes.
      return true
    }
  }

  private directories(create = false): void {
    for (const path of [this.projectPath, join(this.projectPath, '.manifest'), this.recoveryPath]) {
      if (!existsSync(path)) {
        if (!create || path === this.projectPath) throw new Error('An operation evidence folder is missing.')
        mkdirSync(path)
      }
      const stat = lstatSync(path)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Operation evidence requires regular local directories.')
    }
  }

  read(path: string): Buffer {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw new Error('Operation evidence must be a regular file under 50 MB.')
    const bytes = readFileSync(path)
    if (bytes.length > LIMIT) throw new Error('Operation evidence exceeds 50 MB.')
    return bytes
  }

  candidate(): { record: PendingHistoryOperation; bytes: Buffer; inventory: Buffer; history: Buffer } {
    this.directories()
    const bytes = this.read(this.pendingPath)
    const record = JSON.parse(bytes.toString('utf8')) as PendingHistoryOperation
    if (record.version !== 1 || record.projectId !== this.projectId ||
        typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/.test(record.id) ||
        typeof record.label !== 'string' || record.label.length > 300 ||
        typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt)) ||
        record.inventoryFile !== `recovery-${record.id}-before.manifest.json` ||
        record.historyFile !== `recovery-${record.id}-history.json`) throw new Error('Unsupported or invalid operation record. Preserve it for manual recovery.')
    const inventory = this.read(join(this.recoveryPath, record.inventoryFile))
    const history = this.read(join(this.recoveryPath, record.historyFile))
    if (record.inventoryHash !== this.fingerprint(inventory) || record.historyHash !== this.fingerprint(history)) throw new Error('Preserved operation evidence has changed. Keep the files for manual recovery.')
    return { record, bytes, inventory, history }
  }

  begin(label: string, inventory: string, history: string): void {
    this.directories(true)
    if (this.pending()) throw new Error('Review the unfinished history operation first.')
    if (Buffer.byteLength(inventory) > LIMIT || Buffer.byteLength(history) > LIMIT || label.length > 300) throw new Error('Operation evidence exceeds supported limits.')
    const id = randomUUID()
    const record: PendingHistoryOperation = { version: 1, id, projectId: this.projectId, label,
      startedAt: new Date().toISOString(), inventoryFile: `recovery-${id}-before.manifest.json`, historyFile: `recovery-${id}-history.json`,
      inventoryHash: this.fingerprint(inventory), historyHash: this.fingerprint(history) }
    writeHistoryFile(join(this.recoveryPath, record.inventoryFile), inventory)
    writeHistoryFile(join(this.recoveryPath, record.historyFile), history)
    // Published only after both before-state copies have been flushed.
    writeHistoryFile(this.pendingPath, JSON.stringify(record, null, 2))
  }

  finish(preserve = false): void {
    const { record } = this.candidate()
    if (preserve) {
      renameSync(this.pendingPath, join(this.recoveryPath, `recovery-${record.id}-operation.json`))
    } else {
      unlinkSync(this.pendingPath)
      // A crash during cleanup leaves unlisted copies, not a pending operation.
      for (const file of [record.inventoryFile, record.historyFile]) {
        try { unlinkSync(join(this.recoveryPath, file)) } catch { /* Harmless retained evidence. */ }
      }
    }
  }

  fingerprint(...bytes: (Buffer | string)[]): string {
    return createHash('sha256').update(JSON.stringify(bytes.map(value => createHash('sha256').update(value).digest('hex')))).digest('hex')
  }
}
