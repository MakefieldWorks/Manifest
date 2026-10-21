# Releasing Manifest

Release assets come from `.github/workflows/release.yml`. It runs only for a
`v*` tag or a manual dispatch, so macOS and Windows runners never start from an
ordinary push or PR (see the CI policy in `CLAUDE.md`).

| Platform | Asset | Alpha signing |
|----------|-------|---------------|
| macOS (arm64, x64) | `Manifest-<version>-mac-<arch>.dmg` | Developer ID signed, hardened runtime, notarized and stapled |
| Windows (x64) | `Manifest-<version>-win-x64.exe` (NSIS) | Unsigned; SmartScreen warns on first launch |
| Linux (x64) | `Manifest-<version>-linux-x86_64.AppImage` | Unsigned (AppImage has no platform signing) |

Every release also carries `SHA256SUMS.txt` covering all assets.

## Local builds versus release builds

- `bun run package:verify` builds an **unsigned** unpacked app for the host
  platform. On macOS it disables identity discovery and ad-hoc signs the
  bundle, so it never touches your keychain. Use it for local testing only.
- `bun run package` runs electron-builder with the full config. On a Mac with a
  Developer ID Application identity in the login keychain, electron-builder
  signs with it automatically; it notarizes only when the `APPLE_API_*`
  variables below are set. Without them it logs "skipped macOS notarization".
- Release builds come only from the release workflow, so every published asset
  is built from a tagged commit on clean runners.

`node scripts/verify_release.mjs` checks whatever electron-builder put in
`dist/` and writes `dist/SHA256SUMS-<os>.txt`. With `--require-signed` it fails
on an unsigned or unnotarized macOS app or an unsigned Windows executable. The
release workflow passes that flag for tagged macOS builds.

## Signing secrets

Add these under **Settings → Secrets and variables → Actions → Repository
secrets**. Missing macOS secrets produce an unsigned build, which a tagged
release then rejects.

| Secret | Value |
|--------|-------|
| `MAC_CSC_LINK` | Base64 of the Developer ID Application certificate exported as `.p12` (with its private key): `base64 -i DeveloperID.p12 \| pbcopy` |
| `MAC_CSC_KEY_PASSWORD` | Password chosen when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Full text of the App Store Connect API key file `AuthKey_<KEYID>.p8` |
| `APPLE_API_KEY_ID` | That key's Key ID |
| `APPLE_API_ISSUER` | The Issuer ID shown above the keys list in App Store Connect |

To export the certificate: open Keychain Access, find "Developer ID
Application: …" under My Certificates, expand it to confirm the private key is
attached, then right-click the certificate and choose Export. The API key comes
from App Store Connect → Users and Access → Integrations → App Store Connect
API; a key with the Developer role can notarize. Apple lets you download the
`.p8` once, so keep the original somewhere safe outside the repository.

The workflow writes the `.p8` to the runner's temp directory for the duration of
the job and deletes it afterwards. The certificate goes to electron-builder as
`CSC_LINK`, which imports it into a temporary keychain.

## Cutting a release

1. Set `version` in `package.json` to the release version (for example
   `0.1.0-alpha.2`) in a PR, and merge it. The workflow fails if the tag and
   `package.json` disagree.
2. Optional dry run: **Actions → Release → Run workflow** on `main`. It builds
   and verifies all three platforms and uploads them as workflow artifacts,
   without creating a release.
3. Tag the merged commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag -a v0.1.0-alpha.2 -m "Manifest 0.1.0-alpha.2"
   git push origin v0.1.0-alpha.2
   ```

4. The workflow creates a **draft** release with generated notes. Tags with a
   hyphen (`-alpha.N`, `-beta.N`) are marked as prereleases.
5. Download the DMG on a Mac that has never run a development build, open it,
   and launch Manifest from Applications. Gatekeeper should open it without a
   warning. Check the Windows installer and AppImage the same way, then edit
   the notes and publish the draft.

A published release is public and cannot be fully recalled once people have
downloaded it. If an asset is wrong, delete the draft and the tag, fix, and tag
again rather than replacing files on a published release.

## Identity

The app ID is `com.makefieldworks.manifest`. It becomes the macOS bundle
identifier and seeds the Windows installer GUID, so changing it after a release
makes macOS and Windows treat the next build as a different application.
