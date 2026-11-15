# DeepSeek delegation — drc-worker (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/drc-worker`).

## Review outcome (Claude)

- **Accepted.** Debounced, id-ordered scheduler with a Web Worker and a synchronous fallback for small projects.
- **Amended (Claude):** the synchronous path ran `runDrc` once per subscriber (badge + panel), undoing an earlier fix — now a shared cache. Worker retain/release was in an effect keyed on the inputs, so every edit terminated and recreated the worker (and dropped the pending pass) — retention now lasts the subscriber's lifetime, and identical requests from several subscribers are de-duplicated.
- Verified at runtime in the packaged app with a 320-wire project: the worker (`drc.worker-*.js`) starts under the `ww://` origin, no CSP violations, one worker serves repeated edits, results correct.

## Task prompt

# Task: run the design-rule check off the main thread

`useDrcIssues()` in `src/stores/effectiveLibrary.ts` runs `runDrc(lib, project)`
(`src/model/drc.ts`) synchronously on every project/library change; it feeds the DRC
badge in `src/app/TitleBar.tsx` and the panel `src/reports/DrcPanel.tsx`. For large
projects this blocks typing and dragging.

1. Add a Web Worker `src/workers/drc.worker.ts` that receives `{ id, lib, project }` and
   posts back `{ id, issues }` (or `{ id, error }`). Instantiate it with Vite's
   `new Worker(new URL('../workers/drc.worker.ts', import.meta.url), { type: 'module' })`.
2. Add a small scheduler module (e.g. `src/stores/drcScheduler.ts`) with an injectable
   worker factory so it is unit-testable in Vitest's node environment: debounce requests
   (~150 ms), cancel/ignore out-of-order responses by request id, keep the last good
   result while a new one is computing, and fall back to synchronous `runDrc` when
   `Worker` is unavailable, when the worker errors, or when the project is small
   (choose and justify a threshold, e.g. total wires < 300). Terminate the worker when no
   subscribers remain if that is simple; otherwise note it.
3. Keep `useDrcIssues(): DrcIssue[]` as the public API (stale-while-revalidate is fine);
   optionally expose a `pending` flag and show a subtle "checking…" state in the DRC panel
   header using theme tokens.
4. The packaged app uses this CSP (see `electron.vite.config.ts`):
   `default-src 'self'; script-src 'self'; …` with no `worker-src`. Confirm (and state in
   your notes, flagged as uncertain if you cannot verify) that a same-origin module worker
   is allowed under that CSP via the `script-src`/`default-src` fallback. Run
   `npm run build` and confirm a separate worker chunk is emitted under
   `out/renderer/assets/`; report its filename.
5. Tests: `tests/drcScheduler.test.ts` with a fake worker covering debounce, stale-response
   discard, sync fallback, and error fallback.

Acceptance: typecheck, lint, tests and build pass; behaviour for small projects is
unchanged (synchronous, same results).



## DeepSeek final message (verbatim)

Done. Summary of the work:

- **`src/workers/drc.worker.ts`** — module worker running `runDrc`, posting `{ id, issues }` / `{ id, error }`.
- **`src/stores/drcScheduler.ts`** — debounced (150 ms), id-ordered scheduler with injectable factory, stale-while-revalidate, sync fallback for small projects (`< 300` wires), no-`Worker`, and worker errors; reference-counted worker termination.
- **`src/stores/effectiveLibrary.ts`** — `useDrcIssues()` kept as the public API, now delegates to `useDrc`.
- **`src/reports/DrcPanel.tsx`** — subtle `checking…` state via `useDrcPending()`.
- **`tests/drcScheduler.test.ts`** — fake-worker tests (sync, debounce, stale discard, no-worker fallback, error fallback).

Verification: typecheck pass, lint 0 errors (10 pre-existing warnings elsewhere), tests 233 passed / 8 skipped, build pass with worker chunk `out/renderer/assets/drc.worker-DKm84xSL.js`. Full detail (including CSP/format uncertainty) in `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DEEPSEEK_NOTES — off-main-thread DRC

### What changed (by file)

- **`src/workers/drc.worker.ts`** (new) — a module Web Worker that receives
  `{ id, lib, project }`, runs `runDrc(lib, project)`, and posts back
  `{ id, issues }` or `{ id, error }`. Message shapes are exported as
  `DrcRequestMessage` / `DrcResponseMessage`. `self` is cast to a small local
  `DrcWorkerScope` interface so the file typechecks under the DOM lib without
  adding a WebWorker lib (which would collide with DOM's `self`/`postMessage`).

- **`src/stores/drcScheduler.ts`** (new) — the scheduler. Exposes
  `requestDrc(lib, project)`, `useDrc(lib, project)`, `useDrcPending()`,
  `setDrcWorkerFactory(factory)`, `retainDrcWorker()`, the `useDrcSchedulerStore`
  zustand store, and the constants `DRC_DEBOUNCE_MS` (150) and `DRC_SMALL_WIRES`
  (300).

- **`src/stores/effectiveLibrary.ts`** (modified) — `useDrcIssues()` is unchanged
  as a public API (`DrcIssue[]`) but now delegates to `useDrc(lib, project)` from
  the scheduler instead of running `runDrc` synchronously in a `useMemo`. Removed
  the module-level `drcCache`.

- **`src/reports/DrcPanel.tsx`** (modified) — subscribes to `useDrcPending()` and
  shows a muted, pulse-animated "checking…" next to the error/warning counts while
  a worker pass is in flight.

- **`tests/drcScheduler.test.ts`** (new) — fake-worker tests for small-project
  sync, debounce, stale-response discard, Worker-unavailable sync fallback, and
  worker-error fallback.

### Design decisions and why

- **Threshold = total wires < 300 stays synchronous.** `runDrc`'s cost is
  dominated by per-wire loops (`validateHarness` / `resolveAllEndpoints`,
  unterminated-pin and shield-continuity checks). Below ~300 wires that is a few
  milliseconds, and the structured-clone serialization of the whole
  library + project plus a worker round-trip would cost more than it saves. The
  constant is exported so it is easy to tune.

- **Stale-while-revalidate.** `useDrcSchedulerStore.issues` holds the last good
  result. While a new pass is computing we set `pending = true` and leave `issues`
  untouched, so the badge/panel never blank out. The small/no-worker path computes
  synchronously during render (via `useMemo`), preserving the previous behaviour
  for small projects exactly.

- **Out-of-order discard by monotonic id.** `latestId` is bumped at *request* time
  (not dispatch time), so an in-flight response for a now-superseded input is
  dropped even while its replacement is still inside the debounce window.

- **Injectable factory.** `setDrcWorkerFactory(fn)` swaps the real
  `new Worker(new URL('../workers/drc.worker.ts', import.meta.url), { type: 'module' })`
  for a fake, making the scheduler testable in Vitest's node environment (where
  `typeof Worker === 'undefined'`). Availability is decided by: a factory is
  injected, or `typeof Worker !== 'undefined'`, and `workerFailed` is false.

- **Worker failure is permanent.** On a worker `onerror` or an `{ error }` response
  we set `workerFailed`, terminate the worker, and re-run the latest input
  synchronously. Subsequent requests stay synchronous rather than thrashing a
  broken worker. `setDrcWorkerFactory` resets this flag.

- **Worker lifecycle.** Reference-counted via `retainDrcWorker()` from the hook
  effect. When the count reaches zero the worker is terminated and `pending` reset.
  The worker is created lazily (only when a large project actually dispatches), so
  small-project-only sessions never spawn one.

### Guesses / uncertain

- **CSP (flagged uncertain — cannot run the packaged GUI).** The build injects
  `default-src 'self'; script-src 'self'; …` with no `worker-src` and no
  `child-src`. Per CSP Level 3, worker scripts fall back through
  `worker-src` → `child-src` → `script-src` → `default-src`, so a same-origin
  worker is governed by `script-src 'self'` and should be allowed. The worker is a
  same-origin `assets/` file under the `ww://app` origin, so `'self'` matches. I did
  not verify this at runtime.

- **Worker output format.** `npm run build` emits the worker as an IIFE script
  (`drc.worker-*.js`, no `export`/`import`, ~11.85 kB, no react/zustand pulled in).
  It is instantiated with `{ type: 'module' }`. Because the worker is fully
  self-contained (all model deps inlined), it executes correctly regardless of
  whether Vite chose IIFE vs ESM output, but I could not confirm the module
  loading path at runtime.

- **Node has no global `Worker`** (verified: node v20.20.2 `typeof Worker ===
  'undefined'`), so the "no Worker" fallback is exercised by default in tests.

### Known risks

- A *large* project opened with no Worker support (or after a worker failure) will
  run `runDrc` synchronously on the main thread again — unavoidable without a
  worker, but it can block on genuinely huge projects.

- First render of a large project shows stale/empty issues until the first worker
  response lands (with `pending` true). This is the intended stale-while-revalidate
  trade-off.

- React StrictMode (dev) double-invokes effects, causing a retain→release→retain
  churn on the refcount; the worker is only recreated lazily on the next dispatch,
  so the practical cost is negligible.

### Final verification

- `npm run typecheck` — **pass** (both `typecheck:node` and `typecheck:web`).
- `npm run lint` — **0 errors**, 10 pre-existing warnings in
  `scripts/import-ecu-templates/index.ts` (unrelated to this change).
- `npm test` — **233 passed, 8 skipped** (skips are the e2e `smoke.test.ts`).
- `npm run build` — **pass**. Worker chunk emitted at
  `out/renderer/assets/drc.worker-DKm84xSL.js` (11.85 kB).
