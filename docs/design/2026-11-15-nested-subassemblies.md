# Nested subassemblies — design (draft for review)

*Drafted by DeepSeek V4 Pro (read-only run, 15 Nov 2026); reviewed by Claude. Not yet approved — no code has been written.*

## Review notes (Claude)

Code claims verified against `main`: `instantiateSubassembly` is unused, the library store has no undo, schema versions are project 2 / library 1.

Accepted: deriving internal structure from the library definition at resolve time (keeps the live-library behaviour); boundary links as a separate structure consumed only by the netlist; composite per-instance ids (`I::d`); cycle detection as a hard requirement; byte-identical regression tests for flat projects before touching reports; shipping steps 1–4 before editing.

Amended:

1. **Do not migrate today's subassemblies into nested blocks.** The proposed migration needs a special `__self__` endpoint and produces hollow "pass-through hubs". Today's subassemblies are a different concept — reusable harness templates matched to placed devices — so keep them as their own library kind (rename to "Harness template") and leave them working as they do now.
2. **Schema numbering.** Revision compaction is taking project format v3; nested assemblies would be project v4 / library v2.
3. **Undo.** Rather than clearing the project's undo history when entering a definition, give definition edits their own undo history (temporal store scoped to the definition being edited).

Decision needed from the owner before any implementation: is the need **reuse across projects with one source of truth** (build this design) or mainly **decluttering the canvas** (ship lightweight canvas groups first — see §8.5)?

---

# Design document — nested subassemblies

Scope note: this is a READ-ONLY design. No files were changed. Every claim cites the inlined source by `file`/`function`.

---

## 1. Goals / non-goals

**Goals (v1)**
- A subassembly (`SubassemblyPart`) becomes a *placeable, device-like block* on the Assembly canvas: it owns internal device instances and internal harnesses, exposes a set of boundary ports, and can be wired to from outside exactly like a `DevicePart`.
- **Reuse with live propagation**: several block instances of the same definition; editing the definition updates every instance. This is the app's existing "live library" choice — `effectiveLibrary.ts:6-7` says *"editing a part in the library still updates the projects that use it"* — extended from parts to structure.
- Internal connectivity flows through reports, DRC, BOM, cutlist, netlist and WireViz, with per-instance stable ids so reports and DRC can address an object inside a specific instance.
- Lossless migration of today's harness-only subassemblies.

**Non-goals (v1, explicit)**
- **No per-instance local overrides.** A block instance is *only* `{partId, label, position}`; you cannot tweak an internal device in one instance without changing the definition. (Flagged as the top open question in §8.)
- **No arbitrary depth in the v1 UI polish**, though the data model and flatten algorithm support it recursively. Cycle detection is required (see §8).
- **No auto-pruning of external wiring** when exposed ports change — that is non-destructive and surfaces as DRC errors (matches the existing `pruneInstanceFromHarness` philosophy, which only prunes on explicit removal).
- Not redesigning the two-ended legacy harness model; internal harnesses are plain `Harness` values.

---

## 2. Data model

### 2.1 Type changes (`src/model/types.ts`)

**Changed** — `SubassemblyPart` (currently `harness: Harness` + flat `exposedPorts`):

```ts
export interface ExposedPort {
  id: string
  name: string
  pinoutTemplateId: string   // boundary port's pinout — must match the internal port's template
  side: PortSide
  /** The internal device port this boundary port is a pass-through for. */
  internal: { deviceInstanceId: string; portId: string }  // ids scoped to the definition
}

export interface SubassemblyPart extends PartBase {
  kind: 'subassembly'
  devices: DeviceInstance[]     // internal devices; ids scoped to the definition, not the project
  harnesses: Harness[]          // internal harnesses; endpoints reference internal device ids
  exposedPorts: ExposedPort[]
  // legacy (pre-migration only):
  harness?: Harness             // the v1 saved harness — removed after migration
}
```

Key points:
- Internal `devices`/`harnesses` live **in the library definition**, not in the project. This is what makes definition-edit → all-instances work without a sync step: the project only stores the placed block instance (`DeviceInstance.partId = subassembly.id`), and internal structure is *resolved from the library at report/render time*, the same way `resolveEndpoint` (`derivation.ts:18-42`) already resolves a device's ports from `lib.parts[instance.partId]`.
- `exposedPorts[].internal` reuses the existing `HarnessEndpoint`-shaped `{deviceInstanceId, portId}` pair, but the ids are *definition-scoped*, not project-scoped.

**Reused unchanged:** `DeviceInstance` is the block instance (no new "SubassemblyInstance" type). This is exactly what the currently-dead `instantiateSubassembly` already sketches (`subassembly.ts:27-31`, builds a `DeviceInstance` with `partId: subassembly.id`).

**Optional add** — a `bomPolicy` field (see §3): `bomPolicy?: 'expand' | 'self'` on `SubassemblyPart`, defaulting to `'expand'`.

### 2.2 Resolution & stable ids

The project stores only `DeviceInstance {id, partId, label, position}`. A new `flattenProject(lib, project)` produces a virtual flat view:

- **Top-level devices** → unchanged instances.
- **Block instance `I`** → a *pseudo-device* with `ports = subassembly.exposedPorts` (id `I`).
- **Internal device `d` of `I`** → instance id `I::d`.
- **Internal harness `h` of `I`** → harness id `I::h`.
- **Boundary links** (see §3): for each `ExposedPort e → internal {d, p}`, a link `(I, e) ⇄ (I::d, p)`.

**Stable-id scheme**: composite ids are the deterministic concatenation of the instance path and the definition-internal id: `I::d`, `I::h`, and for nested blocks `I::J::d` (a *path*, not a single string). Stability guarantees:
- `I` is stable because it is persisted in the project (`DeviceInstance.id`, `nanoid()` at placement — `ops.addInstance`, `ops.ts:68-80`).
- `d`/`h` are stable because they are persisted in the library part.
- The composite is therefore stable across sessions, per-instance, and across re-expansions. Reports key off it; **DRC targets** carry the path so the UI can jump into the right canvas; **undo** is unaffected because the flattened view is *derived*, never stored.

`resolveEndpoint` (`derivation.ts:18`) currently does `if (!device || !isDevice(device)) return undefined`, so a block instance resolves to `undefined` today. It is extended (or a sibling `resolveInstancePorts`) to return `exposedPorts` as the pseudo-port list and `pinoutTemplateId` per port, so every existing report/DRC path that walks `project.deviceInstances` keeps working at the top level unchanged.

### 2.3 `.wwv` / `.wwlib` schema bump & migration

- `PROJECT_SCHEMA_VERSION` 2 → **3** (`project-file.ts:23`). Reasons: `deviceInstances` may now reference subassembly parts; `partSnapshots` must carry subassembly internals (see below); and a future `deviceInstances` discriminator may be added.
- `LIBRARY_SCHEMA_VERSION` 1 → **2** (`project-file.ts:24`) because `SubassemblyPart` shape changes (`harness` → `devices`/`harnesses`/`exposedPorts` with `internal` targets). Existing `parseLibraryFile` rejects `version > LIBRARY_SCHEMA_VERSION` (`project-file.ts:162`), so old apps correctly refuse new libraries.

**Migration (harness-only → nested):** an old `SubassemblyPart` has `harness: Harness` whose `endpoints` reference *project* device instances (meaningless outside the source project — that is why `instantiateSubassemblyHarness` re-matches by port id). The only durable data is: the ordered set of endpoint `portId`s, and wires/segments/accessories/splices between end labels. Migration lifts it as:
- `devices: []`, `harnesses: []`,
- `exposedPorts`: one per old endpoint, in order — `{id: nanoid(), name: <port name if resolvable else portId>, pinoutTemplateId: <resolved if the device part is present in the library/snapshot, else ''>, side: 'right', internal: <unset>}`. Exposed ports without a `pinoutTemplateId` become DRC warnings ("exposed port has no pinout"), and their `internal` target is empty until the user assigns one (the migrated part is a *pass-through hub* the user then fleshes out).
- The old `harness.wires`/`segments`/`accessories`/`splices` are preserved as a single internal harness whose endpoints are **exposed-port references** (a boundary harness), so connectivity (A → port1 → … → port2 → B) is retained. This requires `HarnessEndpoint` to be able to reference an exposed port of the *definition itself* — I recommend a reserved internal instance id (e.g. `__self__`) or a separate `boundaryEndpoint` variant; flagged in §8.

`normalizeHarness` (`project-file.ts:60`) already tolerates unknown/missing fields, so old `.wwv` snapshots of old subassembly parts parse; the part-level migration runs in `parseLibraryFile` and in `missingFromLibrary`/`mergeItems`.

---

## 3. Connectivity semantics

### 3.1 How a wire continues into the internal harness

The flatten produces three kinds of entity that the **netlist** union-find (`netlist`, `reports.ts:82-156`) already understands:

1. **External harnesses** — endpoints reference block instance `I` and its exposed ports (unchanged code path, because `I` now resolves as a pseudo-device).
2. **Internal harnesses** — endpoints reference `I::d` internal devices.
3. **Boundary links** — for each exposed port `e → internal {d, p}`, a pin-to-pin union `(I, e, position) ≡ (I::d, p, position)`. Positions align because the exposed port and the internal port **share the same pinout template** (a DRC-enforced invariant).

The netlist change is one line conceptually: after processing all harness wires, iterate boundary links and `union` the two pin keys for every pin position. Connectivity then composes exactly like KiCad hierarchical sheets.

### 3.2 Worked example

Definition **"PowerBlock"**: internal devices `reg` (regulator) and `cap` (capacitor); internal harness wire `reg.out.1 → cap.in.1` (signal "12V"). Exposed ports `IN → reg.in`, `OUT → cap.out`, both template "12V-2pin".

Project: `BAT` (port `P`, pin1 "12V") — external harness — block `B1` `IN`; block `B1` `OUT` — external harness — `LOAD` (`P`, pin1 "12V").

Flattened netlist unions into one net **"12V"**:
`BAT.P.1 ≡ B1.IN.1 ≡ B1::reg.in.1 ≡ B1::reg.out.1 ≡ B1::cap.in.1 ≡ B1::cap.out.1 ≡ B1.OUT.1 ≡ LOAD.P.1`.

- **netlist** (`netlist`, `reports.ts:82`): one net, name "12V" (most-common signal). Works because boundary links carry the same signal on both sides.
- **wiring table** (`wiringTable`, `reports.ts:64`): three logical rows — `BAT → B1 (IN)`, `B1 (IN) → reg → cap → B1 (OUT)` (the internal wire, from-device `B1 · reg`, to-device `B1 · cap`), `B1 (OUT) → LOAD`. The block appears as an intermediate node, which is the correct hierarchical behavior. `wireLabels`/auto-numbering still apply per harness.
- **cutlist** (`cutlist`, `reports.ts:105`): only the *internal* wire's strand contributes (its segment length, if set), multiplied per instance. Boundary links contribute **nothing** (they are not physical wire). This is why boundary links must *not* be modeled as `HarnessWire` — see §3.3.
- **BOM** (`buildBom`, `bom.ts:38`): with `bomPolicy: 'expand'` (default), every internal device (`reg`, `cap`), internal connector (per internal endpoint), internal wire part, accessory and splice is counted **per block instance**. `B1` and `B2` both contribute, so quantities double. The `SubassemblyPart` itself is **not** a BOM line (it's a rollup), unless `bomPolicy: 'self'` (purchased module) — open question in §8.
- **DRC** (`runDrc`, `drc.ts:24`): runs on the flattened view — internal devices missing parts/templates, internal harness validation (`validateHarness`), port-ownership, unterminated pins, current-rating, shield-continuity, splice rules all apply inside the block, with targets carrying the instance path.
- **WireViz** (`wirevizYaml`, `wireviz.ts:28`): operates on a single `Harness`. v1 exports the *flattened* internal harnesses as separate WireViz docs (one per internal harness), with connectors labelled by `I · d`; or a "flatten to one harness" option that stitches boundary links into a single connector list. Recommended v1: export the expanded harness with exposed ports as the intermediate connectors (i.e., treat the block's exposed port as the connector, same as the wiring table).

### 3.3 Representing boundary links (decision)

Boundary links are a **separate flat structure** (`BoundaryLink[]`), *not* `HarnessWire`s, so `cutlist`, `buildBom`, `wiringTable` and `wirevizYaml` don't see phantom wires. Only `netlist` consumes them. This avoids needing a `virtual?: boolean` flag threaded through four report functions.

---

## 4. Editing UX

- **Placing**: drag a subassembly card from `LibraryPane` onto the canvas → `addInstance(partId=sub.id, …)` (replacing the current "Insert into project" that calls `instantiateSubassemblyHarness` at `LibraryPane.tsx:284`). The block renders in `DeviceNode`/`AssemblyView` with its exposed ports as connection handles.
- **Enter to edit**: double-click (or `Enter` on selection, mirroring `LibraryPane.tsx:248`) opens a **SubassemblyEditor** overlay — a sibling of `HarnessEditor` (`harness/`), rendered inside the existing lazy-overlay system (`App.tsx`). It shows the internal devices + harnesses on a nested canvas. A **breadcrumb** (`Assembly › B1 › reg`) is required both for navigation and because nesting is recursive. v1 ships arbitrary depth in the data model but the UI breadcrumb is the only navigation affordance.
- **Exposed ports changing**: when the definition removes/renames an exposed port or changes its pinout template, external wires referencing that port become orphaned. The existing DRC already reports *"Unresolved endpoint(s)"* and *"wire(s) reference pins that no longer exist"* (`drc.ts` via `validateHarness`, `derivation.ts`), and `wiringTable` already renders `(${end})` fallbacks (`reports.ts:71`). **Recommendation: do not auto-prune**; surface as DRC errors with jump targets, and optionally offer an explicit "reconcile/prune" action. This preserves data and matches `removeInstances` behavior (`ops.ts:119-134`, prunes only on explicit removal).
- **Undo boundaries**: this is the sharpest UX issue. `projectStore` is zundo-temporal over `{project}` (`projectStore.ts:91-265`), but `libraryStore` has **no** undo (`libraryStore.ts:36-298`). Editing inside a subassembly writes to the library *definition*, not the project, so those edits are currently **outside the project undo stack**. Recommendation for v1:
  1. Entering a subassembly **clears** the project undo stack (and shows a subtle "editing shared definition" badge), so users never believe they're undoing project state.
  2. Add a lightweight, scoped undo store for definition edits (temporal over the single part being edited), OR accept "no undo inside subassemblies" for v1 and document it. This is flagged as a top risk/decision in §8.

---

## 5. API / MCP impact

New/changed functions in `src/model/api.ts` (`Workspace`-mutating, mirrored in `ops.ts` where a pure/immutable twin is needed):

- `createNestedSubassembly(ws, {deviceIds?, harnessIds?}, name)` — lift a *selection* of placed devices + harnesses into a new definition (generalizes the single-harness `saveAsSubassembly`, `api.ts:659`). Internal ids are remapped (`nanoid`) into the definition's scope, like `instantiateSubassemblyHarness` remaps (`subassembly.ts:56-115`).
- `placeSubassembly(ws, subassemblyId, position)` — `ops.addInstance`.
- `exposePort(ws, subassemblyId, internalDeviceId, internalPortId, {name?, side?})` / `unexposePort(...)` — manage the boundary; default `pinoutTemplateId` from the internal port's template.
- `flattenProject(lib, project)` (pure, in `derivation.ts` or a new `flatten.ts`) — the resolved view consumed by reports; also exposed for MCP inspection.
- `instantiateSubassemblyHarness` (legacy) **retained** for back-compat and migration; `instantiateSubassembly` (currently dead code, `subassembly.ts:17-63`) is **removed or repurposed** — it is confusingly parallel and unused.
- Report endpoints (`netlist`, `bom`, `cutlist`, `wiringTable`, `exportWireViz`) change to consume the flattened view internally; their signatures stay.
- `snapshot.ts` (`withSnapshots`, `snapshot.ts:13`) must **recurse** into subassembly definitions so internal device parts, their templates/connectors, and wire/accessory/splice parts are embedded in the `.wwv` (otherwise a project referencing a nested subassembly won't open on another machine).
- `references.ts` (`findPartReferences`, `findTemplateReferences`) must count references *inside* subassembly definitions, else a part used only inside a subassembly could be deleted leaving dangling ids.

MCP: the MCP server wraps `api.ts`, so `placeSubassembly`/`exposePort`/`flattenProject` surface automatically. `summarize` (`api.ts:777`) should add a block-instance/nested count.

---

## 6. Migration & compatibility

- **Old projects (`.wwv`)**: unchanged projects (no subassembly parts) load and behave identically — the flatten is a no-op when no instance's part is a subassembly. Schema bump is non-breaking for them because `parseProjectFile` migrates older versions up (`project-file.ts:107-151`).
- **Old subassembly parts**: migrated per §2.3 on load/merge (library load and `missingFromLibrary`/`mergeItems`). They remain usable as pass-through hubs; users assign `internal` targets when they flesh them out.
- **Downgrade**: already graceful — older WireWeaver throws `FileFormatError` on `version > PROJECT_SCHEMA_VERSION` / `LIBRARY_SCHEMA_VERSION` (`project-file.ts:110`, `162`). No "save down" path in v1 (consistent with existing behavior).
- **Crash recovery / revisions**: revisions embed a full `Project` (`ProjectRevision.project`), which now may contain subassembly-*referencing* instances; snapshots carry the definitions, so restore works. No new logic beyond snapshot recursion.

---

## 7. Implementation plan

Ordered, independently shippable:

1. **Types + schema + migration** *(S, ~1 day)*. Extend `SubassemblyPart`; bump both schema versions; migrate harness-only parts. *Tests:* `project-file` parse/serialize + migration fixtures. *Low risk.*
2. **Flatten/resolve layer** *(M, ~2-3 days)*. `resolveInstancePorts` (subassembly → pseudo-device) + `flattenProject` with namespacing + boundary links + **cycle detection**. *Tests:* pure-function suite over nested fixtures. *Medium risk (correctness).*
3. **Reports on flattened view** *(M-L, ~3 days)*. Netlist union across boundary links; BOM expand policy; cutlist exclusion of boundary links; wiring table block-node labelling; DRC target paths; WireViz pass-through. *Tests:* golden outputs; **regression tests proving non-nested projects are byte-identical to today** (highest-value guard). **This is the riskiest step** — it touches every report and must not change current behavior for flat projects.
4. **Place + render block** *(M, ~2 days)*. `placeSubassembly`, `DeviceNode` block rendering, exposed-port handles, external wiring. *Tests:* e2e smoke (`tests/smoke.test.ts`).
5. **Enter/edit + breadcrumb + expose/unexpose** *(M-L, ~3 days)*. SubassemblyEditor overlay, definition editing via library store, breadcrumb. *Tests:* e2e + store tests.
6. **Undo boundary + reconciliation** *(M, ~2 days)*. Scoped definition undo (or explicit "no undo" + badge), reconcile-on-port-change flow. *Highest data-loss risk.*
7. **Migration polish + docs** *(S, ~1 day)*.

Ship 1–4 first (nested blocks read/wire correctly); 5–6 unlock *editing* definitions.

**Riskiest step:** #3 (reports on the flattened view), because it must be a strict no-op for flat projects while being correct for nested ones. Mitigate with golden-output regression tests captured from today's functions before any change.

---

## 8. Open questions / alternatives considered

1. **Per-instance overrides** — not in v1. If later needed, the natural extension is a `DeviceInstance`-level `overrides` map (label/position only, never connectivity), or a "detach to local copy" affordance. Recommend deferring.
2. **Boundary harness vs. boundary links** — §3.3 chose links. Alternative (modeling the exposed port as a 1-position connector and adding an internal harness endpoint on it) pollutes cutlist/BOM. Rejected.
3. **Exposed port = pass-through vs. free-standing pinout** — v1 requires the exposed port to share the internal port's pinout template (pass-through). A "free pinout + explicit pin map" is more flexible (Capital-style) but needs a pin-mapping table; defer, flag as future.
4. **BOM rollup vs. expand** — recommend default `expand`, plus `bomPolicy: 'self'` for purchased modules. Needs a product decision on whether the *part's* cost/weight is used in `'self'` mode (it already has `cost`/`weightGrams` on `PartBase`).
5. **Lighter design — "group" devices on the canvas (no library definition).** A `Group` of instances that moves/selects together would be far simpler, fully local, zero library coupling, no migration, and reuses `removeInstances`/multi-select (`uiStore.ts:23`). **But it does not meet two stated goals: reuse across projects, and "edit definition → update all instances."** Recommendation: if the owner's real need is *reuse + single source of truth*, build the nested-assembly design above; if it is merely *decluttering the canvas*, ship `Group` first as a cheap stepping stone (it also becomes the selection primitive that feeds `createNestedSubassembly` in step 1).
6. **Materialize (store internal copies in the project) vs. derive (flatten at resolve time).** Derive is chosen so library edits propagate without a sync/refresh step, matching `effectiveLibrary.ts`. Materialize would break "live library" and add a reconciliation daemon. Flag: derive means DRC/reports can't be *persisted* against internal objects — they are always recomputed, which is already the model (`useDrc` in `effectiveLibrary.ts:108`).
7. **Cycle / self-reference risk (uncertain).** A definition containing itself (directly or transitively) makes `flattenProject` recurse infinitely. v1 must detect this at both `createNestedSubassembly` time (block placing a part into its own ancestor) and defensively in the flattener (depth cap + visited set → DRC error). This is genuinely uncertain and must be a hard requirement, not an afterthought.
8. **Undo inside definitions (uncertain).** Whether to add a scoped library-undo store or accept no-undo is a real product decision; leaning toward a minimal scoped store because "editing a shared thing with no undo" is a data-loss foot-gun.

**Recommendation:** implement the full nested-assembly design (derive + boundary links + `bomPolicy:'expand'`), shipping steps 1–4 first, with cycle detection and flat-project regression tests as hard gates; and treat the scoped-definition-undo question (§4/§8.8) as the one item to resolve with the owner before step 6.

---

### Things I'm flagging as uncertain
- The exact `pinoutTemplateId` for migrated exposed ports (may be blank if the source device part isn't present — becomes a DRC warning).
- Whether "no undo inside subassemblies" is acceptable, vs. the scoped-undo work.
- `bomPolicy` semantics (does `'self'` use the part's `cost`/`weightGrams`?).
- The `instantiateSubassembly` dead-code cleanup should be confirmed with the owner before deletion.
- WireViz nesting depth/format choice (per-harness docs vs. single flattened doc) needs a product preference.
