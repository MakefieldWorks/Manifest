---
name: feedback-renderer-absolute-asset-path
description: An absolute-path string like '/manifest-mark.svg' used as an <img src> in the Svelte renderer works in `bun run dev` but silently fails in the packaged app, because the packaged renderer loads via file:// (win.loadFile), where a leading '/' resolves from the filesystem root, not the app's asset directory.
metadata:
  type: feedback
---

`src/renderer/src/App.svelte` had `const brandMark = '/manifest-mark.svg'`, used
as `<img src={brandMark}>` on the welcome screen (and the create-project screen,
and the header). It rendered fine in `bun run dev` and never failed a test, but
was a broken/missing icon on the welcome screen of the packaged Windows build —
found by manual dogfood testing, not by any automated check.

**Why:** in dev, the renderer is served by the Vite dev server at some origin
like `http://localhost:5173/`, so an absolute path `/manifest-mark.svg` resolves
against that origin — and Vite's dev server serves `public/`-sourced static
assets at the root, so it works. In the packaged app, `src/main/index.ts` loads
the built renderer via `win.loadFile(join(__dirname, '../renderer/index.html'))`
— a `file://` URL. There is no "server root" for a `file://` document; an
absolute path resolves from the OS filesystem root (`file:///manifest-mark.svg`
on Windows, similarly wrong on Mac/Linux), not from the directory the HTML file
actually lives in. The asset genuinely IS copied next to `index.html` in the
build output (`out/renderer/manifest-mark.svg`) and inside the packaged
`app.asar` — this is a path-resolution bug, not a missing-file bug, which is why
`scripts/verify_packaging.mjs`'s `REQUIRED_ASSETS` check (which only checks the
source `resources/` files exist before packaging) couldn't have caught it, and
neither could any unit/e2e test that doesn't actually load the built HTML via
`file://`.

**How to apply:** any Svelte/renderer code that references a static asset by a
literal string path (not a Vite `import`) must use a path relative to
`index.html` (e.g. `'./manifest-mark.svg'`), never a leading-slash absolute
path. `index.html` itself already does this correctly (Vite's HTML asset
pipeline emits `./manifest-mark.svg`, `./favicon.png`, `./assets/...` with the
`./` prefix) — the bug was specifically a hand-written JS string constant that
Vite's bundler doesn't touch, so it silently kept the absolute form. Verified
by extracting the actual packaged `app.asar` (`@electron/asar` `extractAll`)
and confirming the built JS bundle contains `./manifest-mark.svg`, not the bare
`/manifest-mark.svg`, after the fix. If a new icon/logo reference is added the
same way, grep `src="/|= '/|= "/` in `src/renderer/src` for the same pattern.
