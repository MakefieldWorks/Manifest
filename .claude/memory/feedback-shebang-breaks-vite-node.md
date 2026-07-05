---
name: feedback-shebang-breaks-vite-node
description: A leading '#!/usr/bin/env node' shebang breaks any script when it's transitively imported into Vitest/vite-node's SSR module graph — even though the same file runs fine as a direct CLI entry point.
metadata:
  type: feedback
---

`scripts/generate-lab.mjs` has (had) a `#!/usr/bin/env node` shebang so it reads
as a CLI entry point. `tests/unit/generate-lab.test.ts` imports pure functions
from it (`generateTimeline`) to reuse the generator's logic in a fast, no-fs
regression test. This made the test file itself fail with a `SyntaxError:
Invalid or unexpected token`, reported at a nonsensical location (line 2 of the
*test* file, inside a `//` comment).

**Why:** vite-node (Vitest's dev-style SSR module runner) compiles each module
body via V8's `Function()` constructor. `Function()` does not special-case a
leading `#!` shebang the way Node's own script/module loader does — so the
shebang line is a straight syntax error when the file is executed as an
SSR-loaded dependency. Confirmed directly: `new Function(rawSourceWithShebang)`
throws `SyntaxError: Invalid or unexpected token`; stripping the shebang line
fixes it. The *reported* error location is a red herring — Vitest's error
formatter falls back to showing a code frame from whatever file it was last
processing (the importing test file), not the actual file that failed to
compile, so always suspect a transitively-imported dependency's own syntax
first rather than trusting the reported line:column.

**How to apply:** the shebang was dead weight anyway — `package.json` invokes
the script as `bun scripts/generate-lab.mjs` (explicit interpreter), never as
`./scripts/generate-lab.mjs`, so nothing relies on the shebang/executable-bit
for direct execution. Removed it. If a future CLI script under `scripts/`
needs both a real shebang (for direct execution) *and* to be imported by a
test, split the pure logic into a shebang-free module and make the CLI a thin
wrapper — don't keep the shebang on a file anything imports through vite-node.
`scripts/generate-project.mjs` still has a shebang but nothing imports it, so
it's unaffected; leave it alone unless it too gets imported by a test.
