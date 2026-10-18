// TEMPORARY (PR #102): does fs.rmSync return on a folder holding a git repo
// with read-only object files? Run under Node 22 and Electron's Node.
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mode = process.argv[2] ?? 'sync'
const dir = mkdtempSync(join(tmpdir(), 'rmsync-probe-'))
const git = args => execFileSync('git', args, { cwd: dir })
git(['init', '-q'])
writeFileSync(join(dir, 'a.txt'), 'hello')
git(['add', 'a.txt'])
git(['-c', 'user.name=p', '-c', 'user.email=p@p', 'commit', '-qm', 'a'])
git(['gc', '-q'])
console.log(`node ${process.versions.node} electron ${process.versions.electron ?? '-'} mode ${mode}`)
const started = Date.now()
if (mode === 'sync') rmSync(dir, { recursive: true, force: true })
else await (await import('fs/promises')).rm(dir, { recursive: true, force: true })
console.log(`removed in ${Date.now() - started}ms, still exists: ${existsSync(dir)}`)
