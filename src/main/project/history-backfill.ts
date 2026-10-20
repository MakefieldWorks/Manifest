// Background backfill of the per-node history index (history.db). Walks all
// snapshots in chronological order and records any that are missing or
// marked incomplete, yielding to the event loop between snapshots so IPC
// stays responsive.
//
// This is the one piece of ProjectManager state that is self-contained: a
// status for the renderer, a promise for tests, and a token that cancels a
// stale run. The manager calls cancel() whenever the project changes or a
// history operation starts.

import type { Project, Result } from '../../shared/types'
import type { SnapshotHistoryState } from '../../shared/snapshot-history-migration'
import type { GitService } from '../git-service'
import type { HistoryIndexService } from '../history-index'
import type { Logger } from '../logger'

export interface HistoryBackfillStatus {
  inProgress: boolean
  completed: number
  total: number
}

export interface HistoryBackfillDeps {
  git: GitService
  history: HistoryIndexService
  logger: Logger
  currentProjectPath: () => string | undefined
  isBlocked: () => boolean            // an interrupted history operation is pending
  readHistory: () => SnapshotHistoryState
  parse: (raw: string) => Result<Project>
}

const idle = (): HistoryBackfillStatus => ({ inProgress: false, completed: 0, total: 0 })

export class HistoryBackfill {
  private status: HistoryBackfillStatus = idle()
  private token = 0  // bumped on cancel so a stale backfill exits early
  private promise: Promise<void> | null = null

  constructor(private readonly deps: HistoryBackfillDeps) {}

  getStatus(): HistoryBackfillStatus {
    return { ...this.status }
  }

  // Signal any in-flight backfill to exit early and report idle.
  cancel(): void {
    this.token++
    this.status = idle()
  }

  // Awaitable handle for the most recently scheduled backfill. Tests use this
  // to deterministically wait for backfill to finish without polling.
  async wait(): Promise<void> {
    if (this.promise) await this.promise
  }

  // Schedule a backfill in the background. Idempotent — calling repeatedly
  // while one is already running does NOT start a second pass. This lets
  // nodeHistory and openProject both trigger safely without coordinating.
  schedule(): void {
    if (this.deps.isBlocked()) return
    if (this.status.inProgress) return
    // Flip the flag synchronously so concurrent status queries don't see
    // a transient false-idle while run() is still in its
    // pre-listSnapshots prelude.
    this.status = { inProgress: true, completed: 0, total: 0 }
    this.promise = this.run().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      this.deps.logger.error('history backfill crashed', { error: msg })
      this.status = idle()
    })
  }

  private async run(): Promise<void> {
    const { git, history, logger } = this.deps
    const projectPath = this.deps.currentProjectPath()
    if (!projectPath) {
      this.status = idle()
      return
    }

    const myToken = ++this.token
    let allSnapshots
    try {
      allSnapshots = await git.listSnapshots(projectPath)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn('history backfill: list snapshots failed', { error: msg })
      this.status = idle()
      return
    }

    if (allSnapshots.length === 0) {
      this.status = idle()
      return
    }

    const recorded = history.recordedSnapshotIds()
    const incomplete = new Set(history.incompleteSnapshotIds())
    const needsAny = allSnapshots.some(s => !recorded.has(s.name) || incomplete.has(s.name))
    if (!needsAny) {
      this.status = { inProgress: false, completed: allSnapshots.length, total: allSnapshots.length }
      return
    }

    // Determine chronological order. For snapshots that have history.json
    // events, use event push order (authoritative). For legacy snapshots
    // without events, fall back to git's creatordate sort (second-precision,
    // best-effort). Legacy snapshots are placed before recorded ones since
    // events were added later in the project's life.
    const persistedHistory = this.deps.readHistory()
    const recordedIds = persistedHistory.events
      .filter(e => e.type === 'snapshot' && e.snapshotId)
      .map(e => e.snapshotId as string)
    const inRecorded = new Set(recordedIds)
    const tagsByName = new Map(allSnapshots.map(s => [s.name, s]))
    const legacyOrdered = allSnapshots
      .filter(s => !inRecorded.has(s.name))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const recordedOrdered = recordedIds
      .map(id => tagsByName.get(id))
      .filter((s): s is typeof allSnapshots[number] => s !== undefined)
    const chronological = [...legacyOrdered, ...recordedOrdered]
    // inProgress was set to true synchronously by schedule(); here we
    // update total now that we know how many snapshots we'll walk.
    this.status = { inProgress: true, completed: 0, total: chronological.length }
    logger.info('history backfill started', { total: chronological.length })

    let previousProject: Project | null = null
    for (let i = 0; i < chronological.length; i++) {
      // Bail if the project was closed or another backfill superseded us.
      if (myToken !== this.token || this.deps.currentProjectPath() !== projectPath) {
        logger.info('history backfill cancelled', { completed: i, total: chronological.length })
        this.status = { inProgress: false, completed: i, total: chronological.length }
        return
      }

      const snapshot = chronological[i]
      const snapshotId = snapshot.name

      let raw: string
      try {
        raw = await git.readSnapshotManifest(projectPath, snapshotId)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn('history backfill: manifest read failed', { snapshotId, error: msg })
        previousProject = null  // can't trust delta against a snapshot we couldn't read
        this.status.completed = i + 1
        await new Promise(resolve => setImmediate(resolve))
        continue
      }

      const parsed = this.deps.parse(raw)
      if (!parsed.ok) {
        logger.warn('history backfill: manifest parse failed', {
          snapshotId, error: parsed.error.message,
        })
        previousProject = null
        this.status.completed = i + 1
        await new Promise(resolve => setImmediate(resolve))
        continue
      }

      const isFresh = !recorded.has(snapshotId) || incomplete.has(snapshotId)
      if (isFresh) {
        try {
          history.recordSnapshot({
            snapshotId, snapshotOrder: i,
            project: parsed.data, previousProject,
          })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          logger.warn('history backfill: insert failed', { snapshotId, error: msg })
        }
      }

      previousProject = parsed.data
      this.status.completed = i + 1
      await new Promise(resolve => setImmediate(resolve))
    }

    this.status = { inProgress: false, completed: chronological.length, total: chronological.length }
    logger.info('history backfill complete', { total: chronological.length })
  }
}
