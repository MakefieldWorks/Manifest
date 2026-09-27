#!/usr/bin/env node

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

function usage() {
  console.error('Usage: bun run test:dogfood -- --project <project-dir> [--packaged]')
}

function parseArgs(argv) {
  let project
  let packaged = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--project') {
      project = argv[i + 1]
      i += 1
    } else if (arg === '--packaged') {
      packaged = true
    } else if (!project && arg && !arg.startsWith('-')) {
      project = arg
    } else {
      usage()
      process.exit(1)
    }
  }

  return { project, packaged }
}

const args = parseArgs(process.argv.slice(2))
const projectPath = args.project ? resolve(args.project) : ''

if (!projectPath) {
  usage()
  process.exit(1)
}

if (!existsSync(projectPath)) {
  console.error(`Dogfood project does not exist: ${projectPath}`)
  process.exit(1)
}

function packagedExecutablePath() {
  if (process.platform === 'darwin') {
    const macDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    return join(ROOT_DIR, 'dist', macDir, 'Manifest.app', 'Contents', 'MacOS', 'Manifest')
  }
  if (process.platform === 'win32') {
    return join(ROOT_DIR, 'dist', 'win-unpacked', 'Manifest.exe')
  }
  throw new Error(`Packaged dogfood launch is not configured for ${process.platform}`)
}

const packagedExecutable = args.packaged ? packagedExecutablePath() : ''
if (packagedExecutable && !existsSync(packagedExecutable)) {
  console.error(`Packaged Manifest executable does not exist: ${packagedExecutable}`)
  process.exit(1)
}

execFileSync(
  join(ROOT_DIR, 'node_modules', '.bin', 'playwright'),
  ['test', 'tests/e2e/dogfood.e2e.ts'],
  {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      MANIFEST_DOGFOOD_PROJECT: projectPath,
      MANIFEST_DOGFOOD_EXECUTABLE: packagedExecutable,
    },
    stdio: 'inherit',
  },
)
