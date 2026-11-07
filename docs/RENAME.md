# Rename from Manifest to Layertrail

The app was called **Manifest** through `0.1.0-alpha.1`. From `0.1.0-alpha.2`
it is **Layertrail**, with its website at <https://layertrail.app>. This page
records what changed for users and builds, and what stays compatible.

## What changed

| | Before (alpha.1) | Now |
|---|---|---|
| App name | Manifest | Layertrail |
| macOS bundle ID / Windows app ID | `com.makefieldworks.manifest` | `com.makefieldworks.layertrail` |
| Release assets | `Manifest-<version>-<os>-<arch>.<ext>` | `Layertrail-<version>-<os>-<arch>.<ext>` |
| Project document | `Manifest.manifestproject` | `Layertrail.layertrail` |
| Project archive | `.manifestarchive` | `.layertrailarchive` |
| Per-user settings folder | `…/Manifest` | `…/Layertrail` |
| Offline Help scheme | `manifest-help://` | `layertrail-help://` |
| Development environment variables | `MANIFEST_*` | `LAYERTRAIL_*` |
| Snapshot commit author | `Manifest <manifest@local>` | `Layertrail <layertrail@local>` |

## What stays compatible

- **Projects.** Layertrail opens folders that contain `Manifest.manifestproject`
  (or the older `manifest.json`). The first successful open writes
  `Layertrail.layertrail` and removes the old file; the next snapshot records
  that rename in the project's Git history. Snapshots taken before the rename
  stay readable, because reading a snapshot falls back through the older
  document names. Opening a project with Layertrail is one-way: alpha.1 cannot
  open it afterwards.
- **Desktop file association.** Installed builds still register
  `.manifestproject`, so double-clicking an older document opens Layertrail.
- **Archives.** `.manifestarchive` files exported by alpha.1 still restore.
- **Settings and Recent projects.** On first launch, Layertrail copies
  `recent-projects.json` and `app-settings.json` from the old Manifest settings
  folder if its own folder lacks them. Logs are not copied.
- **Theme IDs** stored in settings (`manifest-light` and so on) are unchanged;
  only their labels say Layertrail.

## What intentionally keeps the old name

- The hidden `.manifest/` metadata folder inside each project (history,
  indexes, recovery payloads) and the `*.manifest.json` recovery files in it.
  They are internal, untracked by the project's Git history, and renaming them
  would need a second migration of history records and archives for no visible
  benefit.
- The archive format tag `manifest-project-archive` inside archive files.
- Source identifiers such as `ManifestNode`, `ManifestAPI`, and
  `ManifestView`, where "manifest" names the inventory document rather than the
  product.
- Dated reports and archived design notes under `docs/`, which describe the
  app as it was at the time.

## Upgrading from alpha.1

Because the bundle ID changed, the operating system treats Layertrail as a new
app. It installs next to Manifest instead of replacing it.

- **macOS:** install Layertrail from its DMG, then move Manifest from
  Applications to the Trash.
- **Windows:** run the Layertrail installer, then uninstall Manifest from
  Settings → Apps.
- **Linux:** install the Layertrail package or AppImage, then remove the
  `manifest` package or the old AppImage.

Project folders are not touched by either step.
