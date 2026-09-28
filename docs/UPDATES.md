# Desktop Updates

Manifest uses **manual updates** for the alpha and beta period. It does not
contact an update service at startup or in the background. **Help → Check for
Updates...** opens the [Manifest releases page](https://github.com/MakefieldWorks/Manifest/releases)
in the system browser when the user chooses it. Compare the installed version
in **About Manifest** with the release version. This action needs internet
access; the app and local projects continue working without it.

## Release channels

- **Alpha:** `vX.Y.Z-alpha.N` tags, marked as GitHub prereleases. Expect
  frequent changes and use only with copied pilot projects.
- **Beta:** `vX.Y.Z-beta.N` tags, also marked as prereleases. Use for broader
  testing once alpha feedback is addressed.
- **Stable:** `vX.Y.Z` tags, published as regular releases when a supported
  release is ready.

There is no automatic channel setting or background download. Choose a release
on the releases page and install its asset for your operating system. If no
releases are listed yet, use the local pilot build. Development packages built
with `bun run package:verify` are local test artifacts, not an update feed.

## Installing with or without internet on the target computer

Download the appropriate release asset on a connected computer, transfer it
to the target computer if necessary, close Manifest, and install it manually:

1. **macOS:** Open the DMG for the computer's architecture (arm64 for Apple
   silicon, x64 for Intel) and replace the existing Manifest app in Applications.
2. **Windows:** Run the x64 NSIS installer. Keep the project folders where they
   are; the installer is separate from project data.
3. **Linux:** Replace the x64 AppImage with the new file, make it executable if
   needed, and launch that file.

Open an existing project and check its name, nodes, and snapshot timeline after
updating. Project folders are independent of the installed application. Keep a
copy of important project folders before installing a prerelease.

## Downgrades

App installation can be rolled back manually by installing an older asset, but
project data is **not guaranteed to be backward compatible**. Opening a project
with a newer Manifest version may migrate its document or history format. To
roll back safely, restore a project-folder copy made before that newer version
opened it. Do not rely on an older app to reverse a migration.

Signed, notarized release artifacts and automated update delivery are separate
release-readiness work. Until those are in place, this page describes the
manual pilot flow rather than promising a supported public release channel.
