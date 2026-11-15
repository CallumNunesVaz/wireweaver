# DeepSeek delegation — ci-platforms (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/ci-platforms`).

## Review outcome (Claude)

- **Accepted.** CI split into `checks` (Linux), `e2e` and `package` (Linux/Windows/macOS matrix, unpacked unsigned builds uploaded as artifacts); actions bumped to `@v7` (verified these majors exist); driver now cross-platform (`require('electron')`, `--user-data-dir`); dead constants removed from an import script (lint 0 warnings); audit unchanged (no non-breaking fix upstream).
- First attempt failed silently: it copied a sibling worktree into its own, then a scratch write to `/tmp` was auto-rejected and the run ended with exit 0 and no work. Relaunched with explicit environment notes; second attempt completed.
- Verified locally: lint 0/0, E2E 8/8 with the new driver, `electron-builder --dir` succeeds with all 7 packs in `resources/data`, and the **packaged** Linux app launches from `ww://app/` with the CSP present, lists all bundled packs, and the E2E dialog seam is inert.
- Integration fix (Claude, at merge): the Windows E2E step hard-coded `tests/smoke.test.ts`, which another branch moved; replaced by a portable `vitest.e2e.config.mts` so every OS runs `npm run test:e2e`.

## Task prompt

# Task: cross-platform CI, packaging checks, and housekeeping

1. **CI on all three OSes.** Rewrite `.github/workflows/ci.yml` so that:
   - a `checks` job (ubuntu) runs lint, typecheck, unit tests, build;
   - an `e2e` job runs on a matrix of `ubuntu-latest`, `windows-latest`, `macos-latest`:
     build, install the Electron binary (`node node_modules/electron/install.js` — npm ci
     does not always fetch it), `npm i --no-save playwright-core`, then `npm run test:e2e`
     (Linux under `xvfb-run -a`; Windows/macOS natively);
   - a `package` job on the same matrix runs `npx electron-vite build` then
     `npx electron-builder --dir` (unpacked, unsigned, `CSC_IDENTITY_AUTO_DISCOVERY=false`)
     and uploads the unpacked app as an artifact (short retention), so each platform's
     package is at least produced on every push.
   - Fix the two annotations CI currently prints at `.github#1/#2` — most likely the
     Node 20 runtime deprecation for `actions/checkout@v4` / `actions/setup-node@v4`; bump
     to current majors (flag as uncertain if you cannot confirm the latest versions).
2. **Driver portability.** `.claude/skills/run-desktop/driver.mjs` hard-codes
   `node_modules/electron/dist/electron` (Linux only) and `XDG_CONFIG_HOME`. Resolve the
   executable via `require('electron')` (which returns the platform path), and isolate
   userData on every OS (e.g. launch with `--user-data-dir=<dir>` or set
   `ELECTRON_USER_DATA`-style handling in main behind the unpackaged/E2E guard — choose
   the least invasive approach and explain). Keep `WW_CONFIG_DIR` working.
3. **Packaging config.** Review `electron-builder.yml`: the build must succeed when
   `data/` is absent (the `extraResources` entry for `data/` must not fail the build);
   check `files` still includes everything `out/` needs and nothing from `node_modules`
   is required at runtime (main/preload externalise only `electron` + node builtins —
   verify by reading `out/main/index.js` imports). Run `npx electron-builder --dir` for
   Linux locally and report the result (do not attempt Windows/macOS builds locally).
4. **Housekeeping.** Fix the 10 ESLint `no-unused-vars` warnings in
   `scripts/import-ecu-templates/index.ts` (prefix with `_` or remove truly dead
   constants — read the script first). Re-run `npm audit`; if a non-breaking update of
   `electron-builder` or `typescript-eslint` clears the remaining moderate advisories,
   apply it (you may run `npm install` for those two dev deps only); report before/after.

Acceptance: lint shows 0 warnings and 0 errors; typecheck, tests, build pass; local
`npm run test:e2e` still passes with the updated driver; `npx electron-builder --dir`
succeeds on Linux; the workflow file is valid YAML. Note in DEEPSEEK_NOTES.md which CI
behaviour you could not verify locally (the human will push a branch to test it).



## DeepSeek final message (verbatim)

All tasks complete. Summary of what I did:

**CI (`ci.yml`)** — split into three jobs (`checks` on ubuntu, `e2e` and `package` on a 3-OS matrix), bumped `checkout`/`setup-node`/`upload-artifact` to `@v7` (all `node24`, fixing the two Node 20 deprecation annotations). Windows e2e runs vitest directly since `WW_E2E=1` POSIX syntax breaks under `cmd.exe`.

**Driver (`driver.mjs`)** — `executablePath: require('electron')`, cross-platform userData isolation via `--user-data-dir=<dir>` (verified `app.getPath('userData')` honours it), `os.tmpdir()` defaults, `DISPLAY` only on Linux. Kept `WW_CONFIG_DIR` working. Updated `SKILL.md`.

**Packaging (`electron-builder.yml`)** — no change needed: `data/` absence is handled (electron-builder logs `file source doesn't exist` and skips — confirmed empirically with `data/` temporarily absent, exit 0); `out/main/index.js`/`preload/index.js` externalise only `electron` + `node:*`. `--dir` succeeds.

**Housekeeping** — removed 10 dead constants in `scripts/import-ecu-templates/index.ts`; `npm audit` unchanged (12 moderate, all minimatch via electron-builder + typescript-eslint — both at latest, no non-breaking fix).

Verification: lint 0/0, typecheck pass, 279 tests pass, build pass, e2e 8/8 pass, `electron-builder --dir` succeeds. Details in `DEEPSEEK_NOTES.md` (CI matrix itself can't be run locally — needs a pushed branch).

## DeepSeek build notes (verbatim)

## DeepSeek notes — cross-platform CI, packaging checks, housekeeping

### Summary

All acceptance criteria are met locally (lint 0 warnings/0 errors, typecheck, unit tests,
build, e2e, and `electron-builder --dir`). CI workflow rewritten and validated as YAML,
but **not executed on real GitHub runners** (needs a pushed branch).

### What changed (by file)

#### `.github/workflows/ci.yml` (rewritten)
Split the single `build` job into three jobs:

- **`checks`** (ubuntu) — `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- **`e2e`** — matrix `ubuntu-latest` / `windows-latest` / `macos-latest`: `npm ci`,
  `npm run build`, `node node_modules/electron/install.js` (npm ci does not always fetch
  the Electron binary), `npm i --no-save playwright-core`, then the smoke test. Linux
  installs `xvfb` and wraps in `xvfb-run -a`; macOS runs `npm run test:e2e` natively.
- **`package`** — same matrix: `npm ci`, `node node_modules/electron/install.js`,
  `npx electron-vite build`, `npx electron-builder --dir` with
  `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, then uploads `dist/` with
  `actions/upload-artifact@v7` and `retention-days: 7`.

Action versions bumped to current majors (fixes the two Node 20 deprecation annotations
from `actions/checkout@v4` / `actions/setup-node@v4`): `checkout@v7`, `setup-node@v7`,
`upload-artifact@v7`. All three confirmed via the GitHub API at run time to declare
`using: node24` (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2).

#### `.claude/skills/run-desktop/driver.mjs`
- `executablePath` now `require('electron')` (returns the platform binary path) instead of
  the hard-coded Linux `node_modules/electron/dist/electron`.
- userData isolation is now cross-platform via the `--user-data-dir=<dir>` launch arg
  instead of the Linux-only `XDG_CONFIG_HOME`. Verified with a scratch Electron probe that
  `--user-data-dir` overrides `app.getPath('userData')` even after `app.setName()`.
- `SHOT_DIR` / `CONFIG_DIR` defaults now use `os.tmpdir()` instead of `/tmp/...` (which
  does not exist on Windows). `WW_CONFIG_DIR` / `SCREENSHOT_DIR` still take precedence.
- `DISPLAY` is only defaulted (`:1`) on Linux, and `XDG_CONFIG_HOME` was removed from the
  env (superseded by `--user-data-dir`).

#### `.claude/skills/run-desktop/SKILL.md`
Updated the `launch()` isolation paragraph to describe the new `--user-data-dir` /
`os.tmpdir()` mechanism.

#### `scripts/import-ecu-templates/index.ts`
Removed the 10 dead `const`s (`DT_*_REC_IPN` x4 and `DT_TPL_*` x6) plus their comment
block. They were never referenced anywhere (grep confirmed module-local only) — the
template ids live inline in `LOCAL_TEMPLATES` and `makeDevice` derives IPNs from
`WW-ECU-${id}`. This clears all `no-unused-vars` warnings.

#### `electron-builder.yml` (no change)
Reviewed and left unchanged — it is already correct:
- The `data/` `extraResources` entry does **not** fail when `data/` is absent.
  electron-builder's `copyFiles` logs `file source doesn't exist` and skips (verified in
  `node_modules/app-builder-lib/out/fileMatcher.js:271-274` **and** empirically — see
  below). `data/` is gitignored, so fresh CI checkouts genuinely lack it.
- `files` (`out/**/*`, `!out/renderer/**/*.map`, `!node_modules/**/*`, `package.json`) is
  complete: reading the built `out/main/index.js` / `out/preload/index.js` shows the only
  external `require`s are `electron` + `node:*` builtins, so no `node_modules` are needed
  at runtime. The renderer is fully bundled.

### Design decisions

- **`--user-data-dir` over an env-var guard in main**: least invasive. One launch arg in
  the driver; no main-process change, no new surface in the E2E/unpackaged guard, and it
  works on all three OSes (Chromium switch honoured by Electron). `app.getPath('userData')`
  is the single source of truth the app already uses, so seeding `recent-projects.json`
  into the same dir keeps working (e2e confirmed).
- **Windows e2e invocation**: `npm run test:e2e` is `WW_E2E=1 vitest run
  tests/smoke.test.ts`, which uses POSIX env syntax that `cmd.exe` does not understand.
  I kept `npm run test:e2e` for Linux/macOS and, on Windows only, run
  `npx vitest run tests/smoke.test.ts` with `env: WW_E2E: '1'`. I did **not** change the
  script (would break local `npm run test:e2e` or require adding `cross-env`, which the
  task forbids). This is a deliberate, documented deviation.
- **Dead constants removed rather than `_`-prefixed**: they were truly dead (never
  referenced), so removal is cleaner than keeping misleading documentation.

### npm audit (housekeeping)

Before and after are identical: **12 moderate** advisories, all the single minimatch
advisory `GHSA-g3hv-75wg-m249` (patched in minimatch >= 11.0.1) reached transitively via
`@electron/universal`/`app-builder-lib` (electron-builder) and
`@typescript-eslint/typescript-estree` (typescript-eslint).

- `typescript-eslint` is already at its latest release (`8.72.2`), which depends on
  `minimatch ^10.2.2`.
- `electron-builder` is installed at `26.18.1` (from `^26.15.3`), which still depends on
  `minimatch ^10.2.5` and `@electron/universal 2.0.3`.

No **non-breaking** update clears these (both packages are at latest and would need to
adopt minimatch 11, a major bump they have not yet made). `npm audit fix --force` would
*regress* electron-builder to 24.13.3, so I did **not** apply it and made no dependency
changes.

### Guesses / uncertainties (flag)

- **Action majors (`@v7`)**: confirmed against the live GitHub API at run time
  (checkout 7.0.1, setup-node 7.1.0, upload-artifact 7.0.2; all `using: node24`). Versions
  move fast; the exact patch releases may differ by the time this runs, but the majors are
  current as of this run.
- **CI not executed**: the whole workflow (3-OS matrix, artifact upload, Windows/macOS
  e2e and `--dir`) is unverified on real runners. The human must push a branch. In
  particular:
  - Windows e2e (direct vitest invocation) and macOS e2e are not locally testable.
  - Windows/macOS `electron-builder --dir` output dir names for the artifact glob
    (`dist/` covers `win-unpacked`, `linux-unpacked`, `mac`/`mac-arm64`) are assumed, not
    observed.
  - macOS `--dir` builds an arm64 `.app` on `macos-latest` (Apple Silicon); not signed.
- **`--user-data-dir` on Windows/macOS**: verified only on Linux (scratch probe + e2e).
  It is a standard Chromium switch and expected to behave identically, but unverified
  cross-platform.
- **electron-builder version**: `package.json` pins `^26.15.3`, which resolves to the
  installed `26.18.1`.

### Known risks

- The Windows e2e step relies on `npx` resolving the local `vitest` (installed via
  `npm ci`). If `npx` ever downloads a different vitest there, it would drift; using the
  local `vitest` binary (`npx vitest` resolves to `node_modules/.bin/vitest`) is intended.
- The e2e/package jobs rebuild independently of `checks` (redundant but simple, per the
  task's per-job build steps).

### Verification (exact final output)

- `npm run lint` → `eslint .` exits 0, **no output = 0 errors, 0 warnings**.
- `npm run typecheck` → `typecheck:node` and `typecheck:web` both pass (no errors).
- `npm test` (Vitest) → `Test Files 27 passed | 1 skipped (28)` /
  `Tests 279 passed | 8 skipped (287)` (the skip is the E2E smoke file).
- `npm run build` → builds `out/main/index.js` (32.24 kB), `out/preload/index.js`
  (2.25 kB) and the renderer (2163 modules) successfully.
- `npm run test:e2e` (with updated driver) → `Test Files 1 passed (1)` /
  `Tests 8 passed (8)` in ~11s.
- `npx electron-builder --dir` (Linux) → succeeds; produces `dist/linux-unpacked/` with
  `wireweaver` executable and `resources/{app.asar,build,data}`.
- `npx electron-builder --dir` with `data/` temporarily absent → **exit 0**, logs
  `file source doesn't exist  from=.../data` (twice), build still succeeds; `data/`
  restored afterwards.
