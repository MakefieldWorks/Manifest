# Pilot Dogfood Checklist

Use this checklist to test Manifest as a first user would: with enough data,
history, and change volume to reveal workflow friction. CSV and NetBox JSON
imports are already shipped; use the notes to decide whether a *refinement*,
such as saved import mappings, is warranted.

## Setup

Generate a representative local project:

```bash
bun run generate:project -- --output ./tmp/pilot-dogfood --name "Pilot Lab Inventory" --nodes 750 --depth 6 --branching 4 --snapshots 4 --seed 20260424 --force
```

Package verification should pass before the dogfood pass:

```bash
bun run typecheck
bun run test
bun run test:e2e
bun run package:verify
bun run test:dogfood -- --project ./tmp/pilot-dogfood
```

`package:verify` builds and inspects the host package. On macOS it also ad-hoc
signs and verifies the local unsigned `.app` bundle so launch-blocking signature
issues are caught before manual testing. `test:dogfood` then opens the generated
project through the Electron E2E harness. The final OS shell launch still needs a
manual Finder/Explorer pass.

## Core Workflow

- Launch with no recent projects and choose **Open Example Project**. Confirm
  that it creates a reusable `Manifest Sample Lab` in the user's Documents
  folder, then inspect its templates and compare `baseline-lab` with
  `firmware-update`.
- Open `./tmp/pilot-dogfood` from the packaged app.
- Expand and collapse several deep branches.
- Search for a known property value such as `active`, `maintenance`, or `serial`.
- Select a search result and confirm the tree scrolls to the selected node.
- Rename a mid-tree node and confirm autosave persists after reopening.
- Add a child to a deep node and edit at least two properties.
- Move that child to another parent and confirm ordering remains predictable.
- Create a new snapshot named `dogfood-edit-pass`.
- Compare `generated-04` to `dogfood-edit-pass`.
- Confirm added, moved, renamed, property-changed, and order-only changes are legible.
- Restore `generated-04` and confirm search results and tree selection still behave normally.

## Windows Handoff

Switch to the Windows machine after the macOS verification commands above pass
and the dogfood project has been generated or copied over. From
`C:\code\Manifest`, run:

```powershell
bun install
bun run typecheck
bun run test
bun run test:e2e
bun run package:verify
bun run generate:project -- --output ./tmp/pilot-dogfood --name "Pilot Lab Inventory" --nodes 750 --depth 6 --branching 4 --snapshots 4 --seed 20260424 --force
bun run test:dogfood -- --project ./tmp/pilot-dogfood
```

After the automated checks pass, manually open `dist\win-unpacked\Manifest.exe`
and verify the native Windows frame, taskbar icon, Open Recent menu, file-open
flow, close/quit save behavior, and snapshot compare readability on the packaged
build.

## Notes To Capture

- Any confusing labels, empty states, or disabled controls.
- Any operation that requires too many clicks for a first user.
- Any place where snapshot/compare language feels like Git instead of product UX.
- Any search query a user would naturally try that does not work.
- The shape of data a first import should support.

## Import Refinement Decision Gate

Consider saved mappings or other import refinements only after the dogfood
notes answer:

- What columns/properties are common enough to seed the MVP?
- Is parent-child structure best represented by path columns, parent IDs, indentation, or repeated category columns?
- Should the first import be command/menu-driven, or is a visible onboarding action needed?
- What validation errors must be shown before writing `Manifest.manifestproject`?
