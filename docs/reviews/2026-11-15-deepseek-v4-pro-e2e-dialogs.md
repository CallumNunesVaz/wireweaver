# DeepSeek delegation — e2e-dialogs (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/e2e-dialogs`).

## Review outcome (Claude)

- **Accepted as delivered.** Test-only dialog seam (`electron/main/testDialogs.ts`, active only with `WW_E2E=1` on an unpackaged app; answers still pass through the path-grant checks; empty queue = cancelled), `WW_PACKS_DIR` override under the same guard, a fixture pack, `queueDialog()` in the driver, and an E2E suite split into `tests/e2e/`.
- Verified independently: 16/16 E2E tests pass — Save As then silent Ctrl+S, Open via menu, rejection of an ungranted path (`/etc/hosts`), cancelled Save As stays dirty, wiring CSV and PDF written (`%PDF` header checked), starter-pack install and "nothing new" on reinstall, library copy to a new folder, no page errors.
- Follow-up handled at integration: the `test:e2e` script sets `WW_E2E=1` with POSIX shell syntax, which fails on Windows CI.

## Task prompt

# Task: make native dialogs and pack installation testable end-to-end

Native file dialogs (Open, Save, Save As, PDF/CSV/YAML export, WireViz/library import,
library folder picker) cannot be driven by Playwright, so those flows are untested. Starter
pack installation from the Library Manager is also untested (packs are read from
`data/*.wwlib` next to the app; `data/` is git-ignored, so CI has none).

1. Add a **test-only dialog seam** in the main process: when (and only when)
   `process.env.WW_E2E === '1'` AND `!app.isPackaged`, `dialog.showOpenDialog` /
   `dialog.showSaveDialog` calls made by the IPC handlers are answered from a queue the
   test controls instead of showing a native dialog. Implement it as a small module
   (e.g. `electron/main/testDialogs.ts`) that wraps the two dialog functions; the queue is
   filled through a test-only IPC/`app.evaluate`-friendly hook — prefer exposing a global
   function on the main process (`globalThis.__wwTestDialogs.push({ filePaths: [...] })`
   or `{ canceled: true }`) which Playwright can call via `electronApp.evaluate`. Paths
   returned by the stub must still go through the normal path-grant logic
   (`grantFile` / `grantedDirs`). Never active in packaged builds — say how you ensured
   that.
2. Add a test-only **packs directory override**: `WW_PACKS_DIR` env var (same E2E +
   unpackaged guard) used by `packsDir()`. Add a tiny fixture pack under
   `tests/fixtures/packs/smoke.wwlib` (2–3 parts, 1 template, valid schema).
3. Extend the E2E suite (split into `tests/e2e/*.test.ts` if it grows; update the
   `test:e2e` script in package.json accordingly — do NOT edit `.github/workflows/ci.yml`,
   another change owns it; CI calls `npm run test:e2e`). Cover:
   - Save As to a temp path → file exists, has `schemaVersion`, title shows the name,
     unsaved dot cleared; then edit + Ctrl+S writes to the same path without a dialog.
   - Open via the Project menu (dialog stub) of a fixture project → devices render.
   - Opening a path the user did NOT pick (call `window.ww.project.openPath('/etc/hosts')`
     from the page) is rejected.
   - Cancelled Save As leaves the project dirty and nothing written.
   - Wiring CSV and PDF export write files (PDF starts with `%PDF`).
   - Library Manager → Starter packs lists the fixture pack, Install adds its parts, a
     second Install reports nothing new.
   - Library folder → "Copy my library" to a temp dir moves the library (records exist
     there) and the app keeps working.
   Use temp dirs under `os.tmpdir()` created in the test code; clean them up.
4. Document the seam in `.claude/skills/run-desktop/SKILL.md` (how to queue dialog
   answers) and expose a helper in `driver.mjs` (e.g. `queueDialog(app, result)`).

Acceptance: `npm run build && npm run test:e2e` passes with all new tests; unit tests,
typecheck, lint pass; the seam is inert unless both guards hold.



## DeepSeek final message (verbatim)

All work is complete and verified. Summary of changes:

**Test seam (main process)**
- `electron/main/testDialogs.ts` — wraps `showOpenDialog`/`showSaveDialog`, answering from `globalThis.__wwTestDialogs` (FIFO) only when `WW_E2E==='1'` **and** `!app.isPackaged`. Empty queue → cancelled.
- `electron/main/index.ts` — all 8 dialog call sites now use the wrappers; `packsDir()` honours `WW_PACKS_DIR` under the same guard. Paths still flow through `grantFile`/`grantedDirs`.

**Fixtures & tests**
- `tests/fixtures/packs/smoke.wwlib` — 3 parts + 1 template, `schemaVersion: 1`.
- `tests/e2e/smoke.test.ts` (moved) + new `tests/e2e/dialogs.test.ts` (8 cases covering Save As/Open/cancel/CSV/PDF/pack install/folder copy).
- `package.json` → `test:e2e` runs `tests/e2e --no-file-parallelism`.

**Tooling/docs**
- `driver.mjs` → `queueDialog(app, result)` helper; `SKILL.md` documents the seam; `eslint.config.mjs` gives browser globals to `tests/e2e/**`; `DEEPSEEK_NOTES.md` written.

**Verification (all green)**
- `typecheck` ✓ · `lint` ✓ (0 errors) · `npm test` ✓ (279 passed, 16 skipped) · `build` ✓ · `test:e2e` ✓ (16 passed)

## DeepSeek build notes (verbatim)

## DeepSeek notes — native dialogs & pack installation E2E

### What changed (by file)

- **`electron/main/testDialogs.ts`** (new)
  Test-only seam wrapping `dialog.showOpenDialog` / `dialog.showSaveDialog`.
  Active only when `process.env.WW_E2E === '1'` **and** `!app.isPackaged`; otherwise
  it delegates straight to the real `dialog` functions. The FIFO queue lives on
  `globalThis.__wwTestDialogs` and is filled over `electronApp.evaluate`.
  Answers are `{ filePaths: string[] }` or `{ canceled: true }`. An empty queue
  resolves as *cancelled* (a forgotten queue is safe, not a hang).

- **`electron/main/index.ts`**
  - Imported `showOpenDialog`/`showSaveDialog` and replaced all eight
    `dialog.showOpenDialog` / `dialog.showSaveDialog` calls in the IPC handlers
    (library export/import, project save/open, file exportText/readText,
    report exportPdf, library choosePath). The dirty-close `showMessageBox` is
    intentionally left native (not part of the seam scope).
  - `packsDir()` now honours `WW_PACKS_DIR` under the same guard
    (`isDev && WW_E2E === '1'`), so the starter-pack list can point at a fixture.

- **`tests/fixtures/packs/smoke.wwlib`** (new)
  Minimal valid pack: 3 parts (a connector, a device referencing the pack's
  template, a wire) + 1 pinout template, `schemaVersion: 1`. Ids are `smoke-*`
  so they never collide with the seeded library.

- **`tests/e2e/smoke.test.ts`** (moved from `tests/smoke.test.ts`)
  Only change is the driver import path (`../../.claude/…`).

- **`tests/e2e/dialogs.test.ts`** (new)
  Eight cases: Save As writes + clears the dirty dot + silent Ctrl+S re-save;
  Open via the Project menu renders devices; `openPath('/etc/hosts')` is
  rejected; cancelled Save As stays dirty and writes nothing; wiring CSV and
  PDF report export (PDF asserted to start with `%PDF`); starter-pack list +
  install + second install "nothing new"; library folder "Copy my library".

- **`.claude/skills/run-desktop/driver.mjs`**
  Added `queueDialog(app, result)` helper.

- **`.claude/skills/run-desktop/SKILL.md`**
  Documented the seam (how to queue answers, FIFO semantics, grant note,
  packaged-build inertness, `WW_PACKS_DIR`) and rewrote gotcha #2.

- **`eslint.config.mjs`**
  Browser globals for `page.evaluate` bodies now target `tests/e2e/**/*.ts`
  (was the single `tests/smoke.test.ts`).

- **`package.json`**
  `test:e2e` now runs `WW_E2E=1 vitest run tests/e2e --no-file-parallelism`
  (serial so the two Electron launches never overlap on the shared display).

### Design decisions & why

- **Seam lives in `index.ts`'s module graph, guards inside the wrapper.** Every
  existing dialog call site is swapped to the wrapper, so there is no per-handler
  branching and no risk of a handler forgetting the guard. The guard is checked
  per call, not once at startup, so it cannot be accidentally "baked in".
- **Queue on the main-process global.** `electronApp.evaluate` runs in the main
  process, so `globalThis.__wwTestDialogs.push(...)` is the natural control
  channel; no extra IPC or test-only renderer surface is needed.
- **Cancelled-on-empty.** Returning `{ canceled: true }` (or `filePath: ''`) when
  the queue is empty means a test that forgets to queue cannot silently write to
  an arbitrary location — it just cancels, which the existing handlers already
  treat as a no-op.
- **Grant logic untouched.** The stub only substitutes the dialog *result*; the
  returned paths still pass through `grantFile`/`grantedDirs`/`requireGrantedFile`
  exactly as if the user had picked them, so the seam cannot open/write an
  un-picked file (verified by the `/etc/hosts` test).
- **`WW_PACKS_DIR` mirrors the seam guard** (`isDev && WW_E2E === '1'`), keeping
  a single, reviewable rule for "test-only main-process behaviour".

### How I ensured packaged-build inertness

Both seams check `!app.isPackaged` (`isDev` in `index.ts`, `!app.isPackaged` in
`testDialogs.ts`) in addition to `WW_E2E === '1'`. A packaged app runs from an
asar with `app.isPackaged === true`, so the queue is never consulted and
`packsDir()` never honours the override regardless of environment variables.
Additionally, the queue is only reachable from the main-process global, which a
packaged app's users cannot set.

### Guesses / uncertainties

- **Electron `SaveDialogReturnValue.filePath` is non-optional** (`string`) in this
  toolchain (Electron 45); the cancelled stub therefore returns `filePath: ''`.
  This matches what a real cancelled save returns. Flagged as version-dependent.
- **Test execution order** relies on `--no-file-parallelism`; I did not verify
  behaviour under parallel file execution (the two files mutate `process.env`
  in `beforeAll`, which would be isolated per worker if parallel).
- **Pack-name assertion** uses the `"3 parts · 1 templates"` subtitle rather than
  the `capitalize`-styled name, because `innerText`/`text-transform` interaction
  is inconsistent.

### Placeholders / unfinished

None. All requested flows are implemented and passing.

### Known risks

- The dirty-close `dialog.showMessageBox` remains native; `closeApp` still clears
  the dirty flag over IPC before close (unchanged), so tests never hit it.
- `captureAssemblyPng` (html-to-image) may return `undefined` if the canvas is
  mid-render, but the PDF still generates — the test only asserts `%PDF` and file
  existence, not the embedded diagram.
- The CSV assertion only checks non-empty; it does not verify CSV column contents.

### Final verification output

- `npm run typecheck` — PASS (typecheck:node + typecheck:web, 0 errors)
- `npm run lint` — PASS (0 errors; 10 pre-existing warnings in
  `scripts/import-ecu-templates/index.ts`, unrelated)
- `npm test` — PASS: 27 files, 279 tests passed, 16 skipped (the two E2E files,
  gated by `skipIf(!isE2E)`), 2 files skipped
- `npm run build` — PASS (built in ~340ms)
- `npm run test:e2e` — PASS: 2 files, 16 tests passed (~25s)
