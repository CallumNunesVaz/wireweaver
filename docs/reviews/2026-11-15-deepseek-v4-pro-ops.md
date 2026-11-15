# DeepSeek delegation — ops (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/ops`).

## Review outcome (Claude)

- **Accepted.** One immutable `src/model/ops.ts` now backs both `projectStore` and `api.ts`.
- **Amended (Claude):** `api.addEndpoint` / `api.addWire` silently did nothing (and could return a wrong end label) when a port already belonged to another harness — they now throw a clear error. Store actions marked the project dirty even when an op was a no-op — a `commit()` helper now leaves state untouched when the project reference is unchanged (no dirty flag, no undo entry). Regression tests added for both.
- Accepted behaviour changes: removing a device/endpoint now also remaps editor layout and prunes splices in the API (matching the app).
- Verified: typecheck, lint, 252 unit tests, E2E smoke 8/8.

## Task prompt

# Task: one implementation of project mutations (`src/model/ops.ts`)

Today project mutations are implemented twice: immutably inside the Zustand store
`src/stores/projectStore.ts` (used by the app, with zundo undo history), and mutably in
`src/model/api.ts` (used by the MCP server and tests). They can drift. Make one
implementation.

1. Create `src/model/ops.ts`: pure, immutable functions of the form
   `(project: Project, ...args) => Project` (or `=> { project: Project; id: string }` where
   the caller needs a created id). Never mutate the input; return the same `Project`
   object reference when nothing changed. Cover at least: add/remove(many)/duplicate
   device instance, set instance positions (bulk) and label; add harness (including
   joining an existing harness when an endpoint already belongs to one), import harness,
   add endpoint, remove endpoint (remap wires as api.ts does today), update harness,
   set wires (with `sanitizeTwists`), set/upsert segment, remove/duplicate harness
   (duplicate must remap wire ids, twistedWith and splice wireIds); add/remove accessory;
   add/remove/move splice and assign splice wire (names from `nextSpliceName`); add/restore
   revision; set project meta.
2. Make every mutating action in `projectStore.ts` a thin wrapper:
   `set((s) => ({ project: ops.x(s.project, ...), dirty: true }))`, preserving the
   existing `flushCoalesce()` / `coalesceUndo()` calls exactly, the store's public action
   names and signatures, and returning ids where actions return them today.
3. Make the mutating functions in `api.ts` call the same ops
   (`ws.project = ops.x(ws.project, ...)`), keeping their public signatures, return values
   and error messages (they throw on unknown ids — keep that; ops may return the project
   unchanged for unknown ids, so the api layer keeps its own existence checks where
   needed). Label/reference resolution (`resolvePinRef`, device labels) stays in api.ts.
4. Where api.ts and the store currently behave differently for the same operation,
   pick the behaviour the existing tests require; if no test decides it, prefer the store's
   behaviour and list every such difference in DEEPSEEK_NOTES.md.
5. Add `tests/ops.test.ts` covering each op, including: immutability (input deep-equal
   before/after), duplicate-harness id remapping, endpoint removal remapping, and joining
   an existing harness.

Acceptance: all existing tests pass; no mutation logic remains duplicated between
projectStore.ts and api.ts (grep for it and report); typecheck and lint clean.



## DeepSeek final message (verbatim)

Done. Summary of what I did:

- **`src/model/ops.ts`** (new): pure, immutable project mutations covering every op, plus `addWire`/`updateWire`/`removeWire`/`insertHarness`/`setWires`/`upsertSegment`/`findHarnessByEndpoint` needed to also cover api.ts's mutating functions. Returns the same `Project` reference on no-ops; creation ops return `{ project, id }`/`{ project, revision }`.
- **`src/stores/projectStore.ts`**: all mutating actions are now thin `set((s) => ({ project: ops.x(s.project, …), dirty: true }))` wrappers preserving signatures, ids, and `flushCoalesce`/`coalesceUndo`.
- **`src/model/api.ts`**: mutating functions now `ws.project = ops.x(…)`; `resolvePinRef`/label resolution stays, backed by a new non-mutating `resolveRef` helper.
- **`tests/ops.test.ts`** (new): 22 tests incl. immutability, duplicate-harness id remapping, endpoint-removal remapping, and harness joining.

Verification: typecheck clean, lint 0 errors (10 pre-existing warnings elsewhere), tests `250 passed | 8 skipped`, build succeeds. Behavior-difference decisions are documented in `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DEEPSEEK_NOTES — one implementation of project mutations

### What changed (by file)

#### `src/model/ops.ts` (new)
Pure, immutable project mutations. Every function is `(project, ...args) => Project`
or `{ project, id }` / `{ project, revision }` where a created id/entity is needed.
Inputs are never mutated and the **same `Project` reference** is returned on no-ops
(unknown id, empty bulk update, duplicate endpoint, …).

Functions:
- devices: `addInstance`, `updateInstancePosition`, `updateInstancePositions`,
  `setInstanceLabel`, `removeInstances`, `duplicateInstance`
- harnesses: `addHarness` (join when an endpoint already belongs to a harness),
  `importHarness`, `insertHarness`, `addEndpoint`, `removeEndpoint`, `updateHarness`,
  `setWires`, `addWire`, `updateWire`, `removeWire`, `upsertSegment`, `removeHarness`,
  `duplicateHarness`
- accessories: `addHarnessAccessory`, `removeHarnessAccessory`
- splices: `addSplice`, `removeSplice`, `moveSplice`, `assignSpliceWire`
- revisions/meta: `addRevision`, `restoreRevision`, `setProjectMeta`
- helper: `findHarnessByEndpoint` (read-only, shared by `addHarness`/`addEndpoint`
  and the store's `findHarnessByEndpoint` action)

`removeInstances` delegates to the existing `pruneInstanceFromHarness`
(`src/model/derivation.ts`), so device removal and instance pruning stay the single
canonical implementation. `addRevision`/`restoreRevision` delegate to
`src/model/revisions.ts`.

#### `src/stores/projectStore.ts`
All mutating actions are now thin wrappers around `ops.*`, preserving public action
names/signatures, return values (incl. ids), and the exact
`flushCoalesce()`/`coalesceUndo()` calls. `emptyProject`, `loadProject`, `newProject`,
`markSaved`, `markDirty` and the zundo configuration are unchanged. Removed the
now-duplicated helpers (`findHarnessByEndpoint`, `addEndpointToHarnessFn`) and the
`pruneInstanceFromHarness`/`sanitizeTwists`/`suggestHarnessNames`/`createRevision`/
`restoreRevision`/`nextSpliceName` imports.

#### `src/model/api.ts`
Mutating functions now assign `ws.project = ops.x(...)` and keep their public
signatures, return values and error messages. Resolution (`resolvePinRef`,
`findInstance`, `portIdByName`, device-label auto-naming) stays in api.ts. A new
pure helper `resolveRef` computes a PinRef's end label without mutating, queueing any
new endpoint so callers commit it via `ops.addEndpoint` (this lets `addWire`/
`addSegment` stay immutable). `createHarness`/`insertSubassembly` use
`ops.insertHarness`.

#### `tests/ops.test.ts` (new)
22 tests covering each op, with a `runImmutably` helper that deep-clones the input
and asserts it is untouched. Includes the required duplicate-harness id remapping,
endpoint-removal remapping, and joining-an-existing-harness cases.

### Design decisions

- **`insertHarness` vs `importHarness`**: `importHarness` (store) assigns a fresh id
  and regenerates splice/accessory ids + sanitises twists; `insertHarness` (api) keeps
  the caller's id for `createHarness`/`insertSubassembly`, which need to address the
  harness by id immediately. Neither was in the "cover at least" list; both were needed
  to cover api.ts's remaining mutations.
- **`addWire`/`updateWire`/`removeWire`/`setWires`/`upsertSegment`** were added beyond
  the minimum list because api.ts's `addWire`, `updateWire`, `removeWire` and
  `autoWire` are project mutations too and had to go through ops.
- **`upsertSegment`** uses the store's spread semantics (`{ ...existing, ...patch }`).
  api.ts's `addSegment` builds the patch from only the defined keys (`lengthMm`/
  `label`), preserving the old api behaviour of not overwriting with `undefined`.
- **Id generation stays inside ops** (via `nanoid`), so "pure" here means *no side
  effects / no input mutation*, not referential transparency — consistent with the
  existing pure planners in `src/model/wiring.ts`.

### Behaviour differences chosen (store vs api, where no test decides)

1. **`removeDevice` / `removeInstances`** now use `pruneInstanceFromHarness`, which
   additionally remaps `layout` and prunes splices (old `api.removeDevice` only
   remapped endpoints/wires/segments). Store behaviour preferred; no test decides.
2. **`removeEndpoint`** now also remaps `layout` and prunes splices (old
   `api.removeEndpoint` did not). This matches `pruneInstanceFromHarness`; no test
   decides. It also now runs `sanitizeTwists` on the remapped wires.
3. **`addEndpoint`** enforces the store's cross-harness invariant (an endpoint may
   belong to at most one harness). Old `api.ensureEndpoint` only deduped *within* the
   target harness. No test exercises the cross-harness case.
   - Consequence (untested/edge): `api.addEndpoint`/`addWire` referencing a port that
     is already an endpoint of a *different* harness will not add a duplicate endpoint,
     and `api.addEndpoint`'s returned label can be off by one in that invalid state.
     This only arises when a caller breaks the "one port, one harness" invariant.
4. **Store no-op actions now set `dirty: true`** unconditionally (the task's
   `set((s) => ({ project: ops.x(...), dirty: true }))` template). Previously
   `addEndpointToHarness` left `dirty` untouched when it returned `false`.

### Guesses / uncertainties

- The exact semantics of "return the same Project reference when nothing changed" was
  interpreted as *data-level* no-ops (unknown ids, empty collections). Upserts and
  patch merges that produce a deep-equal-but-new object are not detected (matches the
  original store, which also produced new objects in those cases).
- `structuredClone` in the new tests relies on the Node runtime (already used by
  existing tests, e.g. `stores.test.ts`).

### Placeholders / unfinished

None.

### Known risks

- The `addEndpoint` cross-harness edge (item 3 above) is the only place the api layer
  can now silently diverge from the old mutable implementation, and only for inputs
  that already violated the one-port-one-harness invariant.

### Final verification output

- `npm run typecheck` — clean (both `typecheck:node` and `typecheck:web` pass).
- `npm run lint` — 0 errors; 10 warnings, all pre-existing in
  `scripts/import-ecu-templates/index.ts` (unused constants, unrelated to this change).
- `npm test` — `23 passed | 1 skipped (24)` files; `250 passed | 8 skipped (258)` tests
  (the skip is the pre-existing `tests/smoke.test.ts` e2e suite).
- `npm run build` — succeeds (`electron-vite build`, main/preload/renderer all built).

### Duplication check

Grep for mutation patterns (`.push(`, `.filter(`, `.map(`, `deviceInstances:`/
`harnesses:` reassignment, `sanitizeTwists`, `pruneInstanceFromHarness`,
`nextSpliceName`, `createRevision`, `restoreRevision`) shows:
- `src/stores/projectStore.ts` — no mutation logic remains; only `nanoid()` in
  `emptyProject()` and the initial `deviceInstances: []`/`harnesses: []`.
- `src/model/api.ts` — no `ws.project.deviceInstances =` / `ws.project.harnesses =`
  reassignment remains; remaining `.push(` calls are on local arrays (`pending`,
  `endpoints` during `createHarness`) or the library (`ws.parts.push`,
  `ws.templates.push`), which are out of scope for project mutations.
