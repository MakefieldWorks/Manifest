---
name: feedback-esm-root-dir-windows
description: Never derive a script's ROOT_DIR with `resolve(new URL('..', import.meta.url).pathname)` — on Windows this doubles the drive letter (C:\C:\...). Use fileURLToPath() instead.
metadata:
  type: feedback
---

`scripts/verify_packaging.mjs` and `scripts/run-dogfood.mjs` both computed their
project-root constant as:

```js
const ROOT_DIR = resolve(new URL('..', import.meta.url).pathname)
```

On Windows this produced `C:\C:\code\Manifest` — every path built from `ROOT_DIR`
(e.g. `resources/manifest.svg`) came out doubled and `package:verify` failed with
"Missing required file" even though the file was right there.

**Why:** a `file://` URL's `.pathname` on Windows keeps the WHATWG-spec leading
slash before the drive letter — `file:///C:/code/Manifest/` → pathname
`/C:/code/Manifest/`. That leading `/` is not a valid Windows path on its own.
`path.resolve('/C:/code/Manifest/')` treats the leading `/` as "root of the
current drive" and prepends the current drive letter, then treats the literal
`C:` as an ordinary folder name segment — producing `C:\C:\code\Manifest`.
Confirmed directly: `resolve(url.pathname)` → `C:\C:\code\Manifest`, while
`fileURLToPath(url)` → `C:\code\Manifest\` (correct on both Windows and POSIX —
this is exactly what the built-in is for).

**How to apply:** any script that derives its root/dir from `import.meta.url`
must use `fileURLToPath(new URL('..', import.meta.url))` from Node's `url`
module, never `.pathname` + `resolve()`. `scripts/generate-lab.mjs` already did
this correctly (`fileURLToPath(import.meta.url)` at its `require.main`-equivalent
check) — that was the reference pattern for the fix. Both `verify_packaging.mjs`
and `run-dogfood.mjs` are fixed now; grep `import\.meta\.url` before adding a new
script-root constant to catch this pattern early next time.
Related: [[feedback-shebang-breaks-vite-node]] (found in the same dogfood
verification pass).
