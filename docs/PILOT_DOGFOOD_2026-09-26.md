# Pilot dogfood record — macOS, 2026-09-26

Status: **macOS local pass recorded; Windows and clean-machine checks remain.**
This is a synthetic first-user exercise, not customer validation or a signed
distribution test.

## Environment and fixture

- Host: Apple Silicon Mac, Darwin 27.0.0.
- Commit: `383faac` (`main` at the start of this pass).
- Package: `dist/mac-arm64/Manifest.app`, built with `package:verify` and
  ad-hoc signed locally. It is not Developer ID signed or notarized.
- Fixture: `generate:project` with seed `20260424`, requested 750 nodes,
  depth 6, branching 4, and four snapshots. The generated project contained
  754 nodes, 564 leaves, and four Git snapshots. Separate ignored copies under
  `tmp/` were used for the automated and packaged-app runs.

From the repository root, I generated the automated-run fixture with:

```sh
bun run generate:project -- --output ./tmp/pilot-dogfood-2026-09-26 --name "Pilot Lab Inventory" --nodes 750 --depth 6 --branching 4 --snapshots 4 --seed 20260424
```

For the packaged-app run I used the same command with
`--output ./tmp/pilot-dogfood-packaged-2026-09-26`. Both output directories
were new, so `--force` was unnecessary.

## Checks performed

| Check | Result |
| --- | --- |
| `bun run typecheck` | Passed; no Svelte errors or warnings |
| `bun run test` | 898 passed |
| `bun run package:verify` | Passed; macOS bundle, branding, ad-hoc signature, and `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Manifest.app` |
| `bun run test:e2e` | 85 passed, 1 expected dogfood skip |
| `bun run test:dogfood -- --project ./tmp/pilot-dogfood-2026-09-26` | Passed |

From the repository root, I launched the packaged `.app` through the macOS shell
with an isolated user-data directory and a separate disposable fixture copy:

```sh
open -n -a ./dist/mac-arm64/Manifest.app --args \
  --user-data-dir=/private/tmp/manifest-packaged-dogfood-2026-09-26 \
  "$PWD/tmp/pilot-dogfood-packaged-2026-09-26"
```

The packaged UI showed the project and 754 nodes. Searching `active` returned 149 matches, with
50 loaded initially; the selected result appeared in the tree with its matching
property. Comparing `generated-01` to `generated-04` showed 33 changes, including
modified, added, removed, moved, renamed, and ordering changes.

In the packaged app I renamed `Device 00345` to `Device 00345 QA`, saved
`dogfood-edit-pass`, and compared it to `generated-04`. The rename appeared in
the comparison. I reverted to `generated-04` and saw the original name return.
I then added `QA Sensor` with `serial=QA-001` and `status=active`, moved it from
`Device 00345` to `Shelf 00087`, deleted it, and used Undo to restore it. The
project document on disk contained the restored node, destination, and both
properties after quitting the app.

I also launched the packaged app with fresh user data and an isolated example
directory using:

```sh
MANIFEST_EXAMPLE_PROJECTS_DIR=/private/tmp/manifest-packaged-examples-2026-09-26 \
  open -n -a ./dist/mac-arm64/Manifest.app --args \
  --user-data-dir=/private/tmp/manifest-packaged-first-run-2026-09-26
```

The empty hub offered **Open Example Project**; using it created
`Manifest Sample Lab` with six nodes and two snapshots. Comparing `baseline-lab`
to `firmware-update` showed the firmware/status change and the added telemetry
gateway. The native **Open Project** file picker opened the generated 754-node
project. Native **Open Recent** listed both projects and reopened the example.
Finder identified `Manifest.manifestproject` as a **Manifest Project** with
Manifest as the default app. Opening the document from Finder cold-launched the
packaged app into the 755-node edited copy. Opening another selected project
document from Finder while Manifest was running switched it to the 754-node
copy. Both cold and running-app document routes were observed.

## Observed friction

1. A moved-node comparison card displayed the **before** and **after** parent
   as raw internal IDs (for example, UUID-style values) rather than readable
   paths or names. This makes a structural change hard to understand from the
   review panel alone. The tree does mark the moved node, but the card should
   identify both locations in user terms.
2. With the tree, details, and snapshot review all open, the snapshot heading,
   focus-card titles, and tree labels truncate heavily even at a large window
   size. The full path remains available in the accessibility text, but a
   first user may need repeated selection or panel resizing to read it.

No data-loss or workflow-blocking failure was observed in this run. These are
usability observations from one synthetic fixture; priority should be confirmed
with a real pilot task. Both findings are tracked in [TODOS.md](../TODOS.md).

## Remaining before marking the roadmap item complete

- On macOS, launch on a clean machine. The local shell launch, first-run
  example, native file picker, Open Recent, and Finder document routes passed
  on this host.
- On Windows, run the commands and native-shell checklist in
  [PILOT_DOGFOOD.md](PILOT_DOGFOOD.md). No Windows machine was available in this
  session.
- Try a real import file and capture its column shape before deciding whether
  saved mappings or a different import refinement is needed.
- Verify a signed and notarized distribution separately from the local
  ad-hoc-signed package before making a release-readiness claim.

## Follow-up verification — 2026-09-27

After the comparison-readability work merged, I verified `main` at `cfc05d9`
on the same Apple Silicon Mac:

| Check | Result |
| --- | --- |
| `bun run package:verify` | Passed; rebuilt the current macOS package, ad-hoc signed it, and verified its signature and branding assets |
| `bun run generate:project -- --output ./tmp/pilot-dogfood-2026-09-27 --name "Pilot Lab Inventory" --nodes 750 --depth 6 --branching 4 --snapshots 4 --seed 20260424` | Generated 754 nodes and four snapshots |
| `bun run test:dogfood -- --project ./tmp/pilot-dogfood-2026-09-27` | Passed with host-level permission; project opening, search, and snapshot comparison completed |

The first dogfood launch inside the restricted execution sandbox failed with
`electron.launch: Process failed to launch!` and `signal=SIGABRT`. The macOS
crash report's main-thread stack included `___RegisterApplication_block_invoke`
and `_RegisterApplication`, before Manifest code ran. Giving the E2E process an
isolated user-data directory did not change that result. The trial change was
reverted; the committed dogfood test is unmodified. It passed with host-level
launch permission, and a regular hidden-window E2E test passed inside the
sandbox. This is a test environment limitation, not evidence of a packaged-app
failure.

This recheck is still on the development Mac. The separate clean-machine macOS,
Windows, real import-data, and signed-distribution checks above remain open.

## Automated platform and durability follow-up — 2026-09-27

The opt-in [clean-runner workflow run](https://github.com/MakefieldWorks/Manifest/actions/runs/36351084927)
passed on macOS 15 and Windows 2022 before PR #98 merged. It ran typechecking,
unit tests, host packaging verification, the original packaged open/search/compare
smoke test, and the development-build Electron E2E suite. This supplies automated
clean-runner evidence; it does not complete the manual Finder/Explorer checklist.

After PR #99 merged (`ac8b07a`), the pilot test was extended locally to use a
disposable copy of the 754-node fixture and exercise editing and durability:

- Add and rename a node, set serial/status properties, and verify autosave.
- Relaunch the process and find the persisted node by its serial value.
- Save and compare the edited snapshot against a baseline.
- Make an unsnapshotted rename, then revert with a note.
- Relaunch again, verify the baseline inventory and absent probe search result,
  and confirm the later snapshot and revert event remain in the timeline.
- Apply the retained recovery point and verify the unsnapshotted name and both
  properties return. Verify the supplied project document stayed byte-identical.

`bun run typecheck`, `bun run build`, and `bun run package:verify` passed.
`bun run test:dogfood -- --project ./tmp/pilot-durability-check --packaged`
passed against the rebuilt, ad-hoc-signed macOS package (8.9 seconds), with
host-level launch permission. The sandbox launch again aborted with SIGABRT
before opening a window. The development-build run also passed with host-level
permission (8.5 seconds). Its first host-level attempt stalled while macOS
displayed Electron's "unexpectedly quit while reopening windows" recovery
prompt after the sandbox crash; that run was stopped and rerun after the prompt
cleared. Each test launch now has a 30-second timeout so a blocked launch fails
promptly. The expanded test has not yet run on Windows or a separate clean Mac;
the earlier workflow run covered the original smoke test.

Manual native-shell checks, representative real import data, and signed/notarized
distribution verification remain open.
