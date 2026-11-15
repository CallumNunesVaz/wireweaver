# DeepSeek delegation — data-durability (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/data-durability`).

## Review outcome (Claude)

- **Accepted.** Revisions no longer embed their own snapshot maps; top-level snapshots cover the project and every revision; project format v3 hoists v1/v2 revision snapshots on load (top-level wins). Library re-migration after an older build wrote `parts.json` is now a merge by `updatedAt` (newer wins, untimestamped never overwrites, missing records added) with an honest notice that deletions may be restored.
- **Amended (Claude):** with snapshots no longer stored per revision, a part used only by a revision could be deleted from the library (the in-use check only looked at the current project), and restoring that revision would show it missing. `findPartReferences` now also counts revisions — and, fixing a pre-existing gap, splice wire parts and harness accessories. Test added.
- Verified: typecheck, lint, 289 unit tests, E2E 8/8; a v2 file with 10 revisions loads and re-saves as v3 (25 KB → 10 KB) with all revisions and restore intact. DeepSeek's benchmark: 20 revisions × 50 parts, 291 KB → 119 KB.
- Note: v3 projects cannot be opened by builds before this change (they refuse newer formats by design).

## Task prompt

# Task: compact revision history; survive a downgrade of the library format

**A. Revision history size.** `src/model/revisions.ts` stores each revision as a full
`structuredClone` of the project (minus revisions), including `partSnapshots` and
`templateSnapshots`. On save, `withSnapshots` (`src/model/snapshot.ts`) fills the
top-level snapshots. With many revisions a `.wwv` balloons, mostly from duplicated
snapshot maps.

1. Revisions must no longer carry their own `partSnapshots` / `templateSnapshots`.
   Instead, `withSnapshots` must make the top-level snapshots cover every part/template
   referenced by the current project AND by every revision, so restoring an old revision
   still resolves everything.
2. Bump `PROJECT_SCHEMA_VERSION` to 3 in `src/model/project-file.ts`; `parseProjectFile`
   migrates v1/v2 files by hoisting any snapshot entries found inside revisions into the
   top level (top-level entries win on id conflicts), then dropping them from revisions.
   Old files must load without losing anything; v3 files must be rejected by v2 builds
   (already true via the version check).
3. Restoring a revision (`restoreRevision`, `ops` layer) keeps the current top-level
   snapshots (they are a superset).
4. Tests: size reduction (e.g. 20 revisions of a project with 50 snapshot parts: report
   bytes before/after), round-trip, v2→v3 migration, restore after the referenced part
   was deleted from the library still renders via snapshots (`buildEffectiveLibrary`).
   Also update `RevisionsPanel`/diff code only if needed.

**B. Library downgrade safety.** `electron/main/libraryStorage.ts` migrates legacy
`parts.json` / `pinout-templates.json` into per-record files whenever a legacy file
exists, upserting every record. If a user runs an OLDER WireWeaver after migrating, that
build writes a fresh `parts.json`; when they come back to the new build, the migration
would overwrite newer per-record edits with older data and resurrect deleted parts.

5. Make re-migration a merge: when per-record files already exist, a legacy record only
   overwrites the per-record file if its `updatedAt` is strictly newer (records without
   `updatedAt` never overwrite an existing record; missing records are added — the older
   build may legitimately have created them). Record what was merged/skipped in the
   load result's `error`-free path (e.g. a `notice` string the renderer can toast; add it
   to `LibraryLoadResult` in `src/ipc/contract.ts` and show it via `toast` in
   `src/stores/libraryStore.ts`). Deletions made in the new build cannot be distinguished
   from additions made in the old build; prefer keeping data (re-add) and say so in the
   notice.
6. Tests in `tests/libraryStorage.test.ts` for: newer legacy record wins, older legacy
   record skipped, legacy-only record added, notice text.

Acceptance: typecheck, lint, unit tests, build, E2E pass; no data loss paths introduced.



## DeepSeek final message (verbatim)

**A. Compact revision history**
- `ProjectRevision.project` no longer carries snapshot maps; `createRevision` strips them.
- `withSnapshots` now collects references from the current project *and* every revision, so top-level snapshots cover everything.
- `PROJECT_SCHEMA_VERSION` → 3; `parseProjectFile` hoists v1/v2 revision snapshots to the top level (top-level wins) and drops them from revisions.
- `restoreRevision` keeps the current top-level snapshots (a superset).

**B. Library downgrade safety**
- `migrateLegacyFile` is now a merge: a legacy record only overwrites its per-record file when its `updatedAt` is strictly newer (no `updatedAt` → never overwrite); missing records are added; corrupt files are left for quarantine.
- `LibraryLoadResult.notice` added and toasted in `libraryStore.load()`.

Measured size reduction (20 revisions × 50 parts): **291273 → 119053 bytes**.

Verification: typecheck ✅, lint ✅ (0 errors, 10 pre-existing warnings), `npm test` 288 passed, `npm run build` ✅, `npm run test:e2e` 8 passed. Full details in `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DEEPSEEK_NOTES

### What changed (by file)

#### A. Compact revision history (schema v3)

- `src/model/types.ts`
  - `ProjectRevision.project` is now `Omit<Project, 'revisions' | 'partSnapshots' | 'templateSnapshots'>` — a revision no longer carries its own snapshot maps.

- `src/model/revisions.ts`
  - `createRevision` strips `partSnapshots` / `templateSnapshots` (in addition to `revisions`) before cloning, so the revision stores only the project structure.
  - `ProjectLike` narrowed to match the new revision project shape (only `deviceInstances` / `harnesses` are used by the diff).
  - `restoreRevision` now explicitly keeps the current project's top-level `partSnapshots` / `templateSnapshots` (they are a superset of anything the revision referenced), alongside `id` and `revisions`.

- `src/model/snapshot.ts`
  - `withSnapshots` extracts a `collect(p)` helper and runs it over the current project **and every revision's project**, so the single top-level snapshot maps cover parts/templates referenced by any revision.

- `src/model/project-file.ts`
  - `PROJECT_SCHEMA_VERSION` bumped 2 → 3.
  - `parseProjectFile` now, for v1/v2 files, hoists any snapshot entries found inside revisions into the top-level maps (top-level entries win on id conflicts) and drops the snapshot maps from each revision. For v3 files the hoist is a no-op (revisions have none). v3 files are rejected by older builds via the existing `version > PROJECT_SCHEMA_VERSION` check.

#### B. Library downgrade safety

- `electron/main/libraryStorage.ts`
  - `migrateLegacyFile` is now a merge rather than a blind upsert: when a per-record file already exists, a legacy record only overwrites it if the legacy `updatedAt` is strictly newer than the existing record's `updatedAt`; records without a numeric `updatedAt` never overwrite; missing records are added; corrupt/unreadable existing files are left alone for `loadRecords` to quarantine.
  - Added helpers `updatedAtOf` and `dirHasRecords`, and a `LegacyMigration` result carrying `merged`/`skipped`/`added`/`hadExisting`.
  - `loadLibrary` aggregates these across `parts.json` and `pinout-templates.json`, and when a re-migration happened (per-record files already existed) it emits a `notice` describing what was merged/skipped/added, including the caveat that deletions in the new build cannot be told apart from additions in the old build.

- `src/ipc/contract.ts`
  - `LibraryLoadResult` gained an optional `notice?: string`.

- `src/stores/libraryStore.ts`
  - `load()` toasts `res.notice` on the error-free path.

### Design decisions & why

- **Top-level snapshots are the single source of truth.** Storing them once and having `withSnapshots` cover all revisions (current + historical) keeps restore lossless while eliminating the per-revision duplication. Measured reduction for 20 revisions × 50 snapshot parts: **291273 bytes (old v2 shape) → 119053 bytes (new v3 shape)** (~59% smaller).
- **Top-level wins on id conflict during migration** matches the instruction and keeps the newest save authoritative.
- **Merge direction for legacy library records** uses `updatedAt` only, per the spec. Templates (`PinoutTemplate`) carry no `updatedAt` in the current model, so a legacy template will never overwrite an existing per-record template — the "newer edits kept" outcome. This is the safe default the task asked for.
- **Corrupt existing per-record files are skipped, not overwritten**, during re-migration, so we never clobber a record we cannot compare with possibly-stale legacy data; `loadRecords` still quarantines and reports them on the normal error path.

### Guesses / assumptions

- "Records without `updatedAt` never overwrite" was interpreted as: `legacyTs === undefined` → skip (never overwrite), even when the existing record also lacks `updatedAt`.
- The `notice` only appears when it is a genuine re-migration (per-record files already existed before a legacy file was seen). A first-time migration of a legacy whole-file store stays silent, preserving existing behaviour and tests.
- The byte-size test reconstructs the "old" v2 shape by copying the top-level maps back into each revision; this is a faithful model of what `createRevision` used to clone.

### Placeholders / unfinished

- None. All four acceptance areas (revision dedup, v2→v3 migration, restore-via-snapshots, library merge) are implemented and covered by tests.

### Known risks

- `tests/model.test.ts` still constructs a hand-written `ProjectRevision` literal that includes `partSnapshots`/`templateSnapshots` in `rev.project` (lines ~582-598). This is now vestigial under the new type, but it is harmless: tests are not part of `tsc` typecheck (only `src/` and `electron/` are), the fields are simply ignored, and the test asserts nothing about them. Left unchanged to minimise churn.
- The migration hoist in `parseProjectFile` runs for every file (not just v1/v2). For v3 it is a no-op, but this means a future format that keeps snapshots in revisions would be silently hoisted too. Acceptable today.
- Subassembly parts' inner harness references are not snapshotted by `withSnapshots` (unchanged from before this run); this predates the task and was left out of scope.

### Verification (final)

- `npm run typecheck` — passes (node + web, no errors).
- `npm run lint` — passes (0 errors; 10 pre-existing warnings in `scripts/import-ecu-templates/index.ts`, unrelated).
- `npm test` — 28 files passed, 1 skipped (smoke/E2E); 288 passed, 8 skipped.
- `npm run build` — passes.
- `npm run test:e2e` — 8 passed (1 file).
