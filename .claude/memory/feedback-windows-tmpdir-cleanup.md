---
name: feedback-windows-tmpdir-cleanup
description: On Windows, fs.rmSync's maxRetries/retryDelay options are silently ignored — use the async fs.promises.rm() instead for any test cleanup that deletes a tmpDir right after closing a SQLite-backed ProjectManager.
metadata:
  type: feedback
---

Every unit test that creates a project in a temp dir and closes a `ProjectManager`
(which owns WAL-mode better-sqlite3 handles via `SearchIndexService` /
`HistoryIndexService`) then deletes that dir in `afterEach`. On Windows this
`rmSync(tmpDir, { recursive: true, force: true })` can throw `EPERM` — not because
a handle is leaked (verified: `flushAndClose()` returns `{ok:true}` and closes both
db handles), but because Windows/antivirus can hold a **transient** exclusive lock
on a just-closed WAL file for anywhere from ~300ms (single test) to >1s (under the
full parallel suite's heavier I/O load). A 300ms-later manual retry always
succeeded in isolation.

**Why:** `fs.rmSync(path, { maxRetries, retryDelay })` documents the same
EBUSY/EPERM retry behavior as async `fs.rm`, but on Node v24.18.0 the sync version
does **not** actually retry — verified against a real exclusive lock (.NET
`FileShare.None` held for 800ms from a background job): `rmSync` with
`maxRetries: 10, retryDelay: 300` still failed in 0ms, while the async
`fs.promises.rm()` with identical options correctly waited and succeeded after
~1.2s. Don't trust `rmSync`'s retry options on Windows — they're a no-op.

**How to apply:** any new test that does `rmSync(tmpDir, { recursive: true, force:
true })` in `afterEach` after closing a ProjectManager/SearchIndexService/
HistoryIndexService should instead `import { rm } from 'fs/promises'` and
`await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })`
(afterEach must be `async`). This is now applied uniformly across all 14
tests/unit files with this pattern (contract, app-settings, git-service,
history-index, project-manager-{close,cloud-sync,import,node-history,nodes,
report,snapshots,templates}, project-open-target, recent-projects) — including a
nested-describe occurrence in project-manager-snapshots.test.ts that used a
differently-named tmp variable (`isolatedTmp`) and was easy to miss on a plain
`rmSync(tmpDir` grep. Plain non-SQLite file deletes (a lone `manifest.json` or
`history.json`) are lower-risk and were left as sync `rmSync`.
