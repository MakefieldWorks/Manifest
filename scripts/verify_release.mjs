#!/usr/bin/env node

// Checks the release assets electron-builder wrote to dist/ for the host
// platform, reports their signing state, and writes SHA256SUMS-<os>.txt.
//
//   node scripts/verify_release.mjs                  # report, fail only on broken signatures
//   node scripts/verify_release.mjs --require-signed # also fail when an asset is unsigned
//
// Linux AppImages are not signed, so --require-signed is a no-op there.

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const DIST_DIR = join(ROOT_DIR, 'dist')
const VERSION = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).version
const REQUIRE_SIGNED = process.argv.includes('--require-signed')

const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
const ASSET_EXTENSIONS = { mac: ['.dmg'], win: ['.exe'], linux: ['.AppImage'] }[OS]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// Runs a command and returns stdout+stderr instead of throwing, because
// codesign and spctl report their findings on stderr and signal failure
// through the exit code.
function probe(command, args, env = {}) {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  }
  catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function releaseAssets() {
  const prefix = `Manifest-${VERSION}-${OS}-`
  const assets = readdirSync(DIST_DIR)
    .filter((name) => name.startsWith(prefix) && ASSET_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .map((name) => join(DIST_DIR, name))
  assert(assets.length > 0, `No ${ASSET_EXTENSIONS.join('/')} assets named ${prefix}* in ${DIST_DIR}`)
  return assets
}

// electron-builder stages each mac arch in its own folder (mac, mac-arm64).
function macAppBundles() {
  return readdirSync(DIST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => join(DIST_DIR, entry.name, 'Manifest.app'))
    .filter((path) => existsSync(path))
}

function verifyMac() {
  const bundles = macAppBundles()
  assert(bundles.length > 0, `No Manifest.app bundles under ${DIST_DIR}/mac*`)

  for (const app of bundles) {
    const details = probe('codesign', ['--display', '--verbose=4', app])
    const signed = details.ok && details.output.includes('Authority=Developer ID Application')

    if (!signed) {
      console.log(`${app}: unsigned (no Developer ID signature)`)
      assert(!REQUIRE_SIGNED, `${app} is not signed with a Developer ID Application certificate`)
      continue
    }

    const verify = probe('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
    assert(verify.ok, `codesign --verify failed for ${app}:\n${verify.output}`)
    assert(/flags=0x10000\(runtime\)/.test(details.output), `${app} is signed without the hardened runtime`)

    const stapled = probe('xcrun', ['stapler', 'validate', app])
    const gatekeeper = probe('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
    if (REQUIRE_SIGNED) {
      assert(stapled.ok, `${app} has no stapled notarization ticket:\n${stapled.output}`)
      assert(gatekeeper.ok, `Gatekeeper rejects ${app}:\n${gatekeeper.output}`)
    }

    const authority = details.output.match(/Authority=(Developer ID Application[^\n]*)/)[1]
    console.log(`${app}: signed by ${authority}; notarized ${stapled.ok ? 'and stapled' : 'NO'}; Gatekeeper ${gatekeeper.ok ? 'accepts' : 'REJECTS'}`)
  }
}

function authenticodeStatus(path) {
  // powershell -Command joins any trailing arguments into the script text, so
  // the path travels through an environment variable instead of being spliced
  // into code. -LiteralPath keeps [] and spaces from acting as wildcards.
  const script = '(Get-AuthenticodeSignature -LiteralPath $env:MANIFEST_SIGN_TARGET).Status'
  const result = probe('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { MANIFEST_SIGN_TARGET: path })
  assert(result.ok, `Get-AuthenticodeSignature failed for ${path}:\n${result.output}`)
  return result.output.trim()
}

function verifyWindows(assets) {
  const targets = [join(DIST_DIR, 'win-unpacked', 'Manifest.exe'), ...assets]
  for (const path of targets) {
    assert(existsSync(path), `Missing ${path}`)
    const status = authenticodeStatus(path)
    console.log(`${path}: Authenticode ${status}`)

    if (status === 'NotSigned') {
      assert(!REQUIRE_SIGNED, `${path} is not Authenticode-signed`)
      continue
    }
    assert(status === 'Valid', `${path} has an invalid Authenticode signature (${status})`)
  }
}

function verifyLinux(assets) {
  for (const path of assets) {
    // Browsers drop the executable bit on download anyway, but a non-executable
    // build output means electron-builder did not finish the AppImage.
    assert((statSync(path).mode & 0o111) !== 0, `${path} is not executable`)
    console.log(`${path}: AppImage (unsigned by design)`)
  }
}

function writeChecksums(assets) {
  const lines = assets.map((path) => {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    // Two spaces before the name is the format `sha256sum -c` expects.
    return `${digest}  ${basename(path)}`
  })
  const out = join(DIST_DIR, `SHA256SUMS-${OS}.txt`)
  writeFileSync(out, `${lines.join('\n')}\n`)
  console.log(`Wrote ${out}`)
}

function main() {
  assert(OS, `Unsupported platform: ${process.platform}`)
  const assets = releaseAssets()

  if (OS === 'mac') verifyMac()
  else if (OS === 'win') verifyWindows(assets)
  else verifyLinux(assets)

  writeChecksums(assets)
}

main()
