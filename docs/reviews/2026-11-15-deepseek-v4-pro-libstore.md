# DeepSeek delegation — libstore (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/libstore`).

## Review outcome (Claude)

- **Accepted.** One file per part/template, atomic writes serialised per library folder, legacy migration (re-runs safely after a crash; legacy files renamed, never deleted), per-record corruption quarantine.
- **Amended (Claude):** pending changes were cleared before the write, so a failed write (disk full, permissions) silently lost edits — failed changes are now requeued unless superseded, with a regression test.
- Verified on a real 2,698-part legacy library in the app: migration ~2 s once (then 75 ms loads), all records present, legacy files kept as `*.migrated-*`; typecheck, lint, 236 tests, E2E 8/8.
- Known limit: downgrading to an older WireWeaver after migration will not see edits made since (older builds read the renamed single files).

## Task prompt

# Task: per-record library storage

The library is persisted as two JSON files (`parts.json`, `pinout-templates.json`) that
the main process rewrites in full on every edit (≈2 MB with 2,700 parts). Make an edit
write only what changed.

1. Extract storage into `electron/main/libraryStorage.ts` — plain Node (`node:fs/promises`,
   `node:path`, `node:crypto`), NO `electron` import, so Vitest can test it against a temp
   directory. Layout: `<libDir>/parts/<key>.json` and `<libDir>/templates/<key>.json`,
   where `<key>` is the id if it matches `^[A-Za-z0-9_-]{1,100}$`, otherwise a sha256 of
   the id (the record still stores its real id). Keep `<libDir>/images/` as is.
2. Functions: `loadLibrary(dir)` → `{ parts, templates, isNew, error? }`;
   `applyChanges(dir, { upsertParts, removePartIds, upsertTemplates, removeTemplateIds })`;
   a one-time migration inside `loadLibrary`: if legacy `parts.json` /
   `pinout-templates.json` exist and the per-record directories do not, split them into
   records and rename the legacy files to `*.migrated-<timestamp>` (never delete).
   Corrupt individual record files are moved aside (`*.corrupt-<timestamp>`) and reported
   in `error` while the rest of the library still loads — but keep the renderer's existing
   safety rule: when `error` is set the renderer holds back writes until the user chooses
   (`loadError` / `acceptEmptyLibrary` in `src/stores/libraryStore.ts`); adjust that UX
   text if partial loads make "empty library" wording wrong. Use atomic writes (unique temp
   file + fsync + rename, as `writeFileAtomic` in `electron/main/index.ts`).
3. IPC: replace `library:saveParts` / `library:saveTemplates` with a single
   `library:applyChanges` in `src/ipc/contract.ts`, `electron/preload/index.ts` and
   `electron/main/index.ts` (validate the payload shape in main). Update `library:load`,
   `library:relocatePath` (copy the new directories; keep the "back up existing
   destination" behaviour), and `part-lookup:search` to use the new storage.
4. Renderer (`src/stores/libraryStore.ts`): track dirty part/template ids and removals
   since the last flush and send only those through the debounced writer; seeding a new
   library sends the seed records. Keep `flushLibraryWrites()` semantics (used before a
   folder switch and on unload) and `mergeItems`.
5. Tests: `tests/libraryStorage.test.ts` (round-trip, unsafe ids, removal, legacy
   migration, corrupt-record quarantine, concurrent `applyChanges` calls not losing
   writes) using `fs.mkdtemp(os.tmpdir())` inside the test code; update
   `tests/libraryStore.test.ts` for the new IPC call.

Acceptance: typecheck (both `tsconfig.node.json` and `tsconfig.web.json`), lint and tests
pass; existing users' libraries migrate without loss.



## DeepSeek final message (verbatim)

Done. Per-record library storage is implemented and verified.

Summary of changes:
- **`electron/main/libraryStorage.ts`** (new): plain-Node `loadLibrary`, `applyChanges`, `loadParts`, and exported `writeFileAtomic`; per-record `<libDir>/parts|templates/<key>.json` layout with safe-id/`sha256` keying, one-time legacy migration, corrupt-record quarantine (`*.corrupt-<ts>`), atomic writes, and per-dir write serialisation.
- **`src/ipc/contract.ts`** + **`electron/preload/index.ts`**: replaced `saveParts`/`saveTemplates` with a single `library:applyChanges` (typed `LibraryChanges`).
- **`electron/main/index.ts`**: `library:load`/`applyChanges`/`part-lookup:search` use the new storage; `relocatePath` copies `parts/`+`templates/`; payload shape is validated in main.
- **`src/stores/libraryStore.ts`**: dirty-id/removal tracking with a single debounced writer sending only changed records; `flushLibraryWrites`/`mergeItems`/seed preserved.
- **`src/app/App.tsx`**: updated load-error banner wording for partial loads.
- Tests: new `tests/libraryStorage.test.ts` (round-trip, unsafe ids, removal, migration, quarantine, concurrency, fresh-dir), updated `tests/libraryStore.test.ts`.

Verification: `typecheck` passes, `lint` 0 errors (10 pre-existing warnings in an unrelated script), `test` 235 passed / 8 skipped, `build` passes. Full detail in `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DeepSeek notes — per-record library storage

### What changed (by file)

#### `electron/main/libraryStorage.ts` (new)
Plain-Node storage layer (no `electron` import; uses `node:fs/promises`,
`node:path`, `node:crypto`) so Vitest can exercise it against a temp dir.

- Layout: `<libDir>/parts/<key>.json`, `<libDir>/templates/<key>.json`,
  `<libDir>/images/` untouched. `<key>` is the record id when it matches
  `^[A-Za-z0-9_-]{1,100}$`, else `sha256(id)` hex. The record body always keeps
  its real id, so loads never reverse the hash.
- `writeFileAtomic` (exported, reused by `electron/main/index.ts` for
  settings/project/report/PDF writes): unique temp file + `fsync` + `rename`.
- `loadLibrary(dir)` → `{ parts, templates, isNew, error? }`. On first use it
  migrates legacy `parts.json` / `pinout-templates.json` into per-record files
  and renames the legacy files to `*.migrated-<timestamp>` (never deleted). A
  corrupt/legacy-invalid file is renamed `*.corrupt-<timestamp>` and reported.
- Corrupt per-record files are also renamed `*.corrupt-<timestamp>` and reported
  in `error` while the rest still loads.
- `applyChanges(dir, changes)` writes only the named records/removals, serialised
  per directory through a promise chain so concurrent calls can't lose writes.
- `loadParts(dir)` (reads parts only) backs `part-lookup:search`.

#### `electron/main/index.ts`
- Removed local `writeFileAtomic` and `quarantine`, `partsFile`/`templatesFile`;
  imports `applyChanges`, `loadLibrary`, `loadParts`, `writeFileAtomic` from
  `./libraryStorage`. Dropped now-unused `randomBytes` import.
- `library:load` → `loadLibrary(libraryDir())`.
- Replaced `library:saveParts`/`library:saveTemplates` with a single
  `library:applyChanges` that shape-validates the payload (`validateLibraryChanges`)
  before touching disk.
- `library:relocatePath` now copies `parts/` + `templates/` (via `fs.cp`), keeping
  the "back up existing destination" behaviour (`<dir>.backup-<stamp>`).
- `part-lookup:search` reads via `loadParts`.

#### `src/ipc/contract.ts`
- Added `LibraryChanges { upsertParts, removePartIds, upsertTemplates, removeTemplateIds }`.
- Replaced the two save channels with `'library:applyChanges'`; updated `WwApi.library`.

#### `electron/preload/index.ts`
- `library.applyChanges` replaces `saveParts`/`saveTemplates`.

#### `src/stores/libraryStore.ts`
- Dirty tracking (module-level `Map`/`Set` of dirty parts/templates and removed
  ids, out of store state so edits don't re-render) replaced the two full-array
  debounced writers with one `persistChanges` writer that snapshots-and-clears
  only the changed records and sends them via `applyChanges`.
- `flushLibraryWrites()` keeps its semantics (flushes the single writer).
- `load()` resets dirty state up front; seeding marks the seed records dirty.
- `acceptEmptyLibrary` now also schedules a flush of any held-back edits.

#### `src/app/App.tsx`
- Adjusted the load-error banner wording ("Some library records could not be
  read." / button "Continue and save") since a partial load is no longer an
  "empty library".

#### Tests
- `tests/libraryStorage.test.ts` (new): round-trip, unsafe-id hashing, removal,
  legacy migration, corrupt-record quarantine, concurrent `applyChanges`, fresh
  dir → `isNew`, using `fs.mkdtemp(os.tmpdir())`.
- `tests/libraryStore.test.ts`: switched mock/assertions from `saveParts`/
  `saveTemplates` to `applyChanges`, and asserts seeding sends the seed records.

### Design decisions & why
- **Keying:** safe-id-as-filename keeps the common case human-readable; hashing
  unsafe ids avoids path traversal / weird characters without ever mutating the
  stored id.
- **Move (not copy) aside for corrupt records:** the task says "moved aside", and
  copying would leave the bad `.json` in place to be re-reported (and later
  overwritten) on the next load. Renaming removes it from the load path while
  preserving the bytes.
- **Migration trigger is "legacy file exists"** rather than "and per-record dirs
  do not exist": a successful migration renames the legacy file away, so the
  simpler condition is equivalent for the normal case but also re-runs
  (idempotently, since records are upserted) after a crash mid-migration —
  reducing the window for lost parts.
- **Serialisation per directory:** `applyChanges` calls chain on a per-resolved-dir
  promise queue. This guarantees concurrent writes land in call order. (Per-record
  atomic renames already avoid torn files; the queue is belt-and-braces for
  ordering.)
- **Dirty state kept out of the Zustand store:** avoids re-render churn and keeps
  `beforeunload`/`flushLibraryWrites` simple. It is reset at the top of `load()`.

### Guesses / uncertain
- "Moved aside" interpreted as `fs.rename` (not `fs.copyFile`). This differs from
  the old `quarantine` (which copied); flagged as intentional.
- `part-lookup:search` reads all per-record files per query (same data as before,
  just many small reads). It is not currently called by the renderer (a local
  fuse.js search is used), so no debounce work was done here.
- Record ordering after load is now by id (deterministic); the old single-file
  order was insertion order and is not recoverable per-record. The Library pane
  search/sorting is unaffected in practice.
- `isNew` is defined as "no legacy files and zero loaded records".

### Placeholders / unfinished
None known. `acceptEmptyLibrary` retains its (slightly legacy) name for minimal
churn; only its UI label and doc comment changed.

### Known risks
- Crash exactly between writing per-record files during a legacy migration and
  renaming the legacy file: on next load migration re-runs and upserts (safe);
  but a crash after renaming the legacy file and before all records were written
  is not possible because the rename happens last. Still, migration is not
  wrapped in a transaction — a hard kill mid-migration leaves a partially-written
  `parts/` dir plus the (still-present, unrenamed) legacy file, which re-migrates
  on next load.
- `loadParts` has the side effect of quarantining a corrupt record it encounters;
  in practice `library:load` already quarantines corrupt records at startup, so
  search won't normally hit them.
- Lint still reports 10 pre-existing `no-unused-vars` **warnings** in
  `scripts/import-ecu-templates/index.ts` (unrelated to this change); 0 errors.

### Final verification
- `npm run typecheck` — passes (both `tsconfig.node.json` and `tsconfig.web.json`).
- `npm run lint` — 0 errors, 10 pre-existing warnings (see above).
- `npm test` — 235 passed, 8 skipped (smoke suite), 0 failed.
- `npm run build` — passes (electron-vite builds main/preload/renderer).
