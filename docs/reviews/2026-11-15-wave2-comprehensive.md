# WireWeaver — Completeness, UX and Performance Review

**Reviewed:** 15 Nov 2026, branch `wave2`, commit `c430b95` plus the uncommitted
CI/E2E configuration changes in the working tree (`package.json`,
`.github/workflows/ci.yml`, `vitest.e2e.config.mts`).

**Scope:** Electron main/preload, React renderer, pure model layer, reports,
library, MCP server, tests and build/CI.

**Purpose:** a fresh review of the current tree, focused on what is complete,
what a user can actually reach, and how the product scales. Earlier findings
that remain fixed are not repeated; `REVIEW.md` §9 still holds for the
overlay stack, theming, crash fixes, IPC hardening, per-record library storage
and DRC worker.

---

## Verdict

The core is in good shape: the model is pure, fast and well tested; the
Electron shell has a solid security baseline; the library, keyboard flows and
theming have clearly had a second pass. The remaining problems are
concentrated in **manufacturing correctness** and **features that are present
in the model but not reachable from the UI**.

| Area | Grade | Summary |
|---|---|---|
| Completeness | B− | Core assembly, wiring, reports and library are usable. Several advertised features are partial, unreachable, or only work for simple projects. |
| UX | B− | Strong shell, overlays, focus handling and keyboard support. A few dead-end actions and shortcut-scoping bugs remain. |
| Performance | B | Model and library scale well; report tables and React Flow edges are not virtualised, and a few O(n²) paths remain. |
| Reliability & testing | C+ | Excellent data-safety work, but CI's E2E job is red and malformed project/library data is not fully validated. |
| Documentation | C+ | Detailed, but several statements now contradict the code. |

**Release-relevant headline:** `npm run test:e2e` fails 1 of 16 tests. The
product now writes project format **3**, while the E2E test still expects
**2** (`tests/e2e/dialogs.test.ts:148`). The failure is a stale expectation,
not a runtime regression, but it makes the cross-platform E2E job fail.

---

## 1. What was verified

| Check | Result |
|---|---|
| `npm run typecheck` | Pass (node + web) |
| `npm run lint` | Pass (0 errors) |
| `npm test` | Pass: 294 tests, 16 skipped, 30 files |
| `npm run build` | Pass |
| `npm run test:e2e` | **Fail: 15 passed, 1 failed** on `schemaVersion` (expected 2, received 3) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| App driven with Playwright | Opened an 80-device / 79-harness / 1,580-wire project; exercised Reports and Harness Editor |
| Model benchmarks | Run directly against the compiled model layer (see §4) |

The E2E run exercised the native-dialog seam, Save/Save As, Open, CSV/PDF
export, starter-pack installation and library relocation. All of those passed;
only the schema-version assertion failed.

---

## 2. Completeness

### 2.1 Manufacturing data is wrong for multi-conductor cables

This is the most consequential finding in the review.

A wire part can declare `conductors: 4` (`src/model/types.ts:58`), and the
Harness Editor's "lay cable" path creates one `HarnessWire` per conductor
(`src/model/wiring.ts:182-202`). Both the BOM and the cutlist then count
**strands as if each were a separate cable**.

- `buildBom` bumps a wire part once for every wire with that `wirePartId`
  (`src/model/bom.ts:58-59`).
- `cutlist` creates a row per wire and groups by wire part/gauge/colour/length
  (`src/model/reports.ts:110-130`).

**Reproduced:** one 4-core cable with a $10 unit cost, laid between two 4-pin
connectors, produced:

```
BOM:     4-core cable, quantity 4, extended cost $40
Cutlist: 4-core cable, quantity 4
```

The correct result is **one cable** (and one cut length per cable, or a
conductor-level cut list that says so explicitly). The model has no "cable
instance" entity to group its strands, so this cannot be fixed by changing one
row; it needs either a per-cable identity or an explicit divisor/reporting
rule.

Related: assigning a multi-core part to existing wires
(`assignWirePart`, `src/model/wiring.ts:119-150`) has the same effect — every
strand is independently counted as a part.

### 2.2 The netlist ignores splices

Splices are a first-class harness object (`HarnessSplice`,
`src/model/types.ts:152-158`) and are validated in DRC, but the netlist
union-find only unions the two pins of each physical wire
(`src/model/reports.ts:184-205`). It never unions wires that meet at a splice.

**Reproduced:** two wires (A1–B1 and A2–B2) joined by a splice still form
**two nets**. Electrically they are one net. This makes the netlist unsafe as
a cross-check for any design that uses splices, and the HTML report inherits
the same error because it calls `netlist`.

### 2.3 Duplicating a harness creates an invalid project

`Ctrl+D` on a selected harness calls `duplicateHarness`
(`src/app/App.tsx:97-101`), which copies the harness and its wires but keeps
the **same endpoints** (`src/model/ops.ts:350-376`). Endpoints are device/port
pairs, so the copy immediately violates the one-port-one-harness invariant.

**Reproduced:** duplicating a valid two-endpoint harness made DRC report:

```
Port on "D1" belongs to more than one harness.
Port on "D2" belongs to more than one harness.
```

There is no UI to re-point the duplicated harness at different ports, so the
action is currently a dead end. Either remove Duplicate for harnesses, or make
it duplicate wiring onto a *new* pair of endpoints chosen by the user.

### 2.4 The API allows a port to belong to two harnesses

The application's drag and "Connect ports…" paths use `planConnection`
(`src/model/connection.ts:22-43`) and prevent port reuse. `addEndpoint` also
checks ownership (`src/model/ops.ts:218-236`). However, `api.createHarness`
inserts the harness directly (`src/model/api.ts:438-475`) and does **not**
apply that check.

**Reproduced:** constructing 79 harnesses through `api.createHarness` while
reusing one device port produced 78 `Port on ... belongs to more than one
harness` DRC errors.

This matters because `api.ts` is the MCP server's implementation. An agent can
create a project that the app immediately marks as invalid, while an
equivalent app-side action is rejected. The README describes `api.ts` as the
single source of truth; this path should enforce the same invariant.

### 2.5 Feature reachability gaps

These features exist in the model or reports but cannot be used through the
UI, or are only reachable with imported/API data:

| Feature | State in code | Why it is unreachable |
|---|---|---|
| Connector current rating | `ConnectorPart.currentRatingAmps`, DRC rule `src/model/drc.ts:173-188` | `PartForm` has no field for it (`src/library/PartForm.tsx:307-365`). Only API-created or imported parts can trigger the rule. |
| Per-pin current rating | `PinDef.maxCurrentAmps` (`src/model/types.ts:90`) | `TemplateForm` exposes signal and signal class only (`src/library/TemplateForm.tsx:96-136`). |
| Placeholder parts | `PartBase.isPlaceholder`, DRC checks, `seedPlaceholderParts()` | `seedPlaceholderParts` is never called; no form exposes `isPlaceholder`. Fresh libraries never contain the generic parts. |
| Bundle/segment labels | `bundleLabels` / `bundleLabelsCsv` (`src/model/reports.ts:313-355`) | Neither function is imported anywhere. The cutlist CSV has no label column. |
| Endpoint removal | `ops.removeEndpoint` and `api.removeEndpoint` exist | No UI calls them. A harness with an accidental third endpoint can only be deleted wholesale, or the whole device removed. |
| Exposed subassembly ports | `SubassemblyPart.exposedPorts` | `createSubassembly` always sets `[]` (`src/model/subassembly.ts:23`); there is no editor for it. |
| Per-endpoint accessories | `HarnessAccessory` has no endpoint reference | Inspector adds accessories to the whole harness only (`src/inspector/Inspector.tsx:300-336`). |
| Mating connector in BOM | `resolveEndpoint` exposes `matingConnector` | `buildBom` bumps only `re.connector` (`src/model/bom.ts:52-56`); the mating connector is displayed in the Inspector but never purchased. |

### 2.6 WireViz interoperability is partial and partly incorrect

**Import** (`src/model/wireviz-import.ts`) creates connectors and cables, but:

- ignores `pinlabels` entirely, so imported templates have blank signal names
  and cannot be auto-wired;
- ignores `connections`, so the imported document loses its wiring;
- if a connector uses `pincount` + `pinlabels` without a `pins` array, the
  generated template has **zero pins** (`info.pins ?? []`).

The UI calls this "Import parts & templates from WireViz YAML", so it is at
least labelled honestly, but "import" in the README/roadmap implies more than
it delivers.

**Export** (`src/model/wireviz.ts`) has correctness issues:

- Per-wire striped colours are stored as CSS gradients by the colour picker.
  Export writes that raw string into `colors:` (verified: a
  `repeating-linear-gradient(...)` string appeared in the YAML). WireViz
  expects colour abbreviations or hex, not CSS.
- It only derives striped colours from `WirePart.stripedColor`, a field that
  neither the part form nor `WirePartInput` sets.
- It does not emit shields, twisted pairs or wire labels, and does not model
  splices.

### 2.7 Subassemblies are a reusable-harness template, not nested assemblies

To be fair, the README and the design note are explicit that true nested
assemblies are not implemented. The current feature is weaker than "save and
reuse" suggests:

- `createSubassembly` copies the harness but exposes no boundary ports
  (`src/model/subassembly.ts:12-25`).
- `instantiateSubassembly` — the function that would place a subassembly as a
  device-like block — is unused.
- "Insert" matches saved endpoints to already-placed devices by **port id**
  (`src/model/subassembly.ts:104-159`). It works only when the same device
  parts are already placed, and silently drops unmatched endpoints/wires.
- `findPartReferences` and `withSnapshots` do not descend into
  `SubassemblyPart.harness` (`src/model/references.ts`,
  `src/model/snapshot.ts`). A wire or accessory part used only inside a saved
  subassembly can therefore be deleted, leaving the subassembly with dangling
  ids.

### 2.8 Reports are useful but not a complete build pack

Present: wiring table, cutlist, netlist, BOM, HTML, PDF, WireViz, formboard
preview/SVG, and currency-converted BOM export.

Missing from the self-contained HTML/PDF report:

- harness accessories (they appear in the BOM but not as build instructions);
- splices (they appear nowhere in the document);
- the formboard;
- segment/bundle labels;
- a report diagram that reflects the whole assembly rather than the current
  viewport.

The diagram is captured from the live React Flow viewport
(`src/reports/ReportsModal.tsx:33-43`). There is no fit-to-extents call before
capture, so a report exported while zoomed into one corner embeds only that
corner.

### 2.9 Revisions are shallow

- The UI can create a revision with a label only; the model and MCP support a
  description (`src/reports/RevisionsPanel.tsx:32-43`).
- There is no delete-revision action.
- `diffRevisions` reports added/removed devices and harnesses, and wire-count
  changes (`src/model/revisions.ts:26-61`). It does not report endpoint
  changes, pin-level rewiring, metadata, segment changes, accessories or
  splices, so "No structural differences" can be shown for materially changed
  harnesses.

### 2.10 MCP/API surface

The MCP server exposes 43 tools (verified), but it inherits the API's gaps:

- no update/delete for parts or templates;
- no project rename or metadata update;
- no device-instance rename;
- no endpoint removal;
- no accessory update;
- no revision deletion;
- no formboard/report HTML/PDF tools.

Input validation is thin. For example, `update_wire` passes an arbitrary
`patch` object straight into `ops.updateWire` (`scripts/mcp-server/index.ts:450-462`),
which spreads it over the wire — including `id`. An agent can change a wire's
id without remapping `twistedWith` or splice references. `create_harness`
passes raw arrays for wires/endpoints/segments without per-item checks
(`scripts/mcp-server/index.ts:339-374`).

### 2.11 Documentation drift

- README says the BOM CSV "still sums per currency"
  (`README.md:184-190`), but the Reports modal now exports a converted BOM and
  the Implementation handles missing rates (`src/reports/ReportsModal.tsx:143-174`).
- README describes the library as two whole-file JSON stores
  (`README.md:115-117`); the code now stores one file per record under
  `parts/` and `templates/` (and the README's architecture section says so
  later).
- In-app documentation says the Reports modal has **three** tabs; it has four
  (Formboard was added) (`src/shared/DocumentationDialog.tsx:331-335`).
- In-app documentation says the cutlist CSV "includes bundle labels"; it does
  not (`cutlistCsv`, `src/model/reports.ts:291-301`), and `bundleLabelsCsv` is
  unused.
- In-app documentation says the BOM contains "two [connectors] per harness
  endpoint" (nonsensical/stale), and does not mention splices or currency
  conversion (`src/shared/DocumentationDialog.tsx:351-358`).
- `ROADMAP.md` still marks many shipped items open (splices, accessories,
  striped wires, packs, fuzzy search, placeholders, subassemblies, revisions,
  formboard, calculators, MCP), while several are only partial. The checklist
  is no longer a reliable statement of state.

---

## 3. UX

### 3.1 What works well

- The overlay stack, Escape layering, focus trap/restore, menu keyboard
  navigation and visible focus rings are a clear improvement.
- Keyboard paths for connecting ports (`C`) and adding a wire (`W`) exist and
  are properly gated to the top workspace.
- The library pane and wire sidebar are virtualised; search is fuzzy; packs,
  imports and per-record migration are usable.
- Project rename is in the title bar; unsaved state is shown in the title,
  document title and close prompt.
- Errors persist until dismissed; success toasts auto-dismiss.
- Theme follows the OS and applies before first paint.

### 3.2 Global shortcuts still fire while typing

The shortcut handler is documented as "never while typing", but the modifier
branch runs most commands even when focus is in a text field. Only `Ctrl+D`
and `Ctrl+F` are exempted (`src/app/App.tsx:218-239`).

Consequences: `Ctrl+O` opens a project, `Ctrl+N` starts a new one, `Ctrl+K`
opens the palette, `Ctrl+L` opens the Library Manager, `Ctrl+H` hides the
library, `Ctrl+B` exports the BOM and `Ctrl+R` opens Reports while the user is
editing a part name, harness name or project name. On macOS, `Ctrl+E` also
moves the caret to the end of a line, but the app intercepts it to open the
Harness Editor.

The native `Edit > Undo/Redo` menu items bypass the overlay and text-field
checks entirely (`runMenuCommand`, `src/app/App.tsx:108-134`), so the menu can
undo project state while a dialog is open or a text field has focus.

### 3.3 A library read error shows an empty library

When a library record is corrupt, the main process moves it aside and returns
the successfully parsed records plus an `error`. The renderer then discards
**all** parsed records and stores empty arrays (`src/stores/libraryStore.ts:177-180`).

The banner correctly says writes are paused, but "Continue and save" only
clears the error; it does not reload the good records. The user is left with
an apparently empty library until they press Retry or restart. The per-record
store makes it safe to keep the good records in memory while pausing writes;
the current behaviour is unnecessarily alarming.

### 3.4 Opening a foreign project always offers reconciliation

Opening the generated 80-device project (self-contained snapshots, local
library missing its four parts) immediately covered the canvas with "Add this
project's parts to your library?". That is a reasonable prompt, but it is
modal on every open from another machine. "Not now" works and the project
still renders from snapshots, which is the important part.

Importing all checked items runs `upsertPart`/`upsertTemplate` once per item
(`src/library/ReconciliationDialog.tsx:43-51`); each call copies the whole
parts array. For a project carrying thousands of snapshots this is O(n²) and
can freeze the dialog. `mergeItems` already exists for this exact case.

### 3.5 Harness "wired" status can be premature

`validateHarness` marks a harness `wired` when the number of distinct wired
pin-pairs reaches the smallest positive pin count across endpoints
(`src/model/derivation.ts:154-160`). If one endpoint has two pins and another
has four, wiring the two short-side pins marks the harness green while two
pins on the long side remain unterminated. DRC still reports the
unterminated pins, so the data is safe, but the edge colour/status is
misleading.

### 3.6 The Harness Editor is still shaped for two endpoints

`PinColumnNode` places the "a" column's handle on the right and **every other
column's** handle on the left (`src/harness/PinColumnNode.tsx:19-20`). With
three or more endpoints, b→c and c→d wires therefore leave and enter on the
same side, producing loops that are harder to follow than the grid layout
suggests.

The node's memo comparator compares only the *length* of `wiredPositions`
(`src/harness/PinColumnNode.tsx:95-106`). A change that keeps the count the
same but moves which pins are wired can leave stale pin highlighting (and a
stale `hideUnused` filtered list). `pinColors` is computed and passed but never
rendered, so colour changes never appear on the pin column.

### 3.7 Formboard is a prototype

- The layout is a BFS walk with a 30° fan and a fixed 80px separation
  (`src/model/formboard.ts`); it does not resolve collisions between
  non-adjacent branches, so larger harnesses can overlap.
- The exported SVG has a hard-coded dark background and dark circle fills
  (`src/reports/FormboardView.tsx:52-69`). A 1:1 formboard is usually printed;
  a dark page is wasteful and makes annotations hard to read.
- Edges are drawn only from `harness.segments`; wire pairs without segments
  produce endpoint nodes but no line (`FormboardView.tsx:21-27`).
- It appears only in the Reports preview and as standalone SVG; it is not
  part of the HTML/PDF report.

### 3.8 Smaller UX issues

- `LibraryPane` uses different click semantics: double-click edits a part or
  template, while a single/double click on a subassembly inserts it.
- `ReconciliationDialog` has "Select All" but no "Select None".
- The Reports modal uses one harness selector for both WireViz export and the
  Formboard tab, without saying so.
- The BOM CSV prints `$0.00` for a part with no cost while the extended-cost
  column prints `—` (`src/model/bom.ts:160-172`), which reads as "free" rather
  than "unknown".
- The multi-endpoint harness status and the endpoint label scheme are fine,
  but there is no UI to remove or reorder endpoints.

---

## 4. Performance

### 4.1 Model and library scale well

Timings are single-run, on this machine, against the current source. They are
reported to show order of magnitude, not benchmark precision.

**120 devices, 119 harnesses, 2,380 wires:**

| Operation | Time |
|---|---:|
| `runDrc` | 6.7 ms |
| `buildBom` | 4.5 ms |
| `wiringTableAll` | 3.2 ms |
| `cutlist` | 1.7 ms |
| `netlist` | 5.8 ms |
| `buildEffectiveLibrary` with 3,000 parts | 1.2 ms |

**200 devices, 199 harnesses, 3,980 wires:**

| Operation | Time | Output |
|---|---:|---:|
| `wiringTableAll` | 5.8 ms | — |
| `wiringCsv` | 4.9 ms | 238 KB |
| `buildBom` | 5.0 ms | — |
| `bomCsv` | 6.6 ms | 6 KB |
| HTML report | 26.9 ms | 982 KB |
| `serializeWorkspace` | 0.5 ms | — |
| `JSON.stringify` of serialized project | 1.7 ms | 664 KB |

The pure layer is not the bottleneck. Per-record library storage, the
effective-library cache and the DRC scheduler are doing their job.

### 4.2 Reports tables are not virtualised

`ReportsModal` renders every wiring, cutlist and netlist row
(`src/reports/ReportsModal.tsx:297-379`). With 1,580 wires the modal opened and
rendered in ~213 ms and added ~22,000 DOM nodes (3,052 → 22,152). That is
acceptable for small projects, but a 5,000–10,000-wire project would create
100,000+ nodes and a noticeable stall on every open/switch.

The HTML and CSV paths themselves are fast (27 ms and ~1 MB at 3,980 wires),
so this is a rendering-only problem. `react-virtuoso` is already a dependency
and is used elsewhere.

### 4.3 React Flow edges are not virtualised

`AssemblyView` creates one edge per non-root endpoint, which is cheap. The
Harness Editor creates **one edge per wire** (`src/harness/HarnessEditor.tsx:286-333`)
and does not pass `onlyRenderVisibleElements` to `ReactFlow`
(`HarnessEditor.tsx:800-824`). A star-wired harness with thousands of strands
will mount one SVG edge component per wire. The 20-wire editor test (20 edges,
3,784 DOM nodes) was fine; this is a scaling risk, not a current failure.

### 4.4 Remaining hot spots

- **`DeviceNode` does a linear `find` per node.** Each mounted device
  subscribes to the project and runs
  `project.deviceInstances.find(...)` (`src/assembly/DeviceNode.tsx:29-31`).
  On any project change every node's selector runs, giving O(n²) work across
  the canvas. Fine at 80 devices, worth an id index at hundreds/thousands.
- **Assembly DRC-ish validation is synchronous.** `AssemblyView` calls
  `validateHarness` for every harness on every instance/harness/library change
  (`src/assembly/AssemblyView.tsx:107-111`), separately from the DRC worker.
  This is cheap for the current project sizes but redundant once the project
  is large.
- **Reconciliation import is O(n²)** as described in §3.4.
- **Autosave serialises the full project every 3 seconds** after an edit
  (`src/app/ProjectWatcher.tsx:26-35`). With embedded snapshots and a long
  revision history this is more than the current 664 KB; it can produce
  periodic main-process/IPC work on large projects. No measured hitch yet.
- **Archive-like undo history.** `zundo` keeps up to 100 project states and
  revisions keep full project copies. Structural sharing makes ordinary edits
  cheap, but the growth is worth watching if revision snapshots become part of
  every save.

### 4.5 Library write durability on close

Library writes are debounced by 500 ms, and the only flush on application
close is a `beforeunload` handler that calls an async flush
(`src/stores/libraryStore.ts:120-140`). `beforeunload` does not wait for
promises. A library edit made immediately before closing (or a forced quit)
can therefore be lost even though the edit is visible in the UI. The
project-side close prompt and autosave are better protected than this.

---

## 5. Reliability, data integrity and security notes

### What holds up

- `contextIsolation`, `sandbox`, no `nodeIntegration`, no webviews, blocked
  navigation and `setWindowOpenHandler` denial.
- A strict build-time CSP (`script-src 'self'`), a registered `ww://` scheme
  with path traversal checks, and a sandboxed image protocol.
- Sender validation on every IPC handler, path grants for project/library
  files, and typed IPC shared by main/preload/renderer.
- Atomic writes with `fsync` and unique temp files, per-directory write
  serialisation, corrupt-record quarantine and legacy migration.
- Single-instance lock, `.wwv` file association and crash-recovery autosave.
- Formula-safe CSV cells and escaped HTML reports.
- Electron 45; `npm audit --omit=dev` reports 0 vulnerabilities.

### Remaining gaps

1. **Snapshots are trusted.** `parseProjectFile` casts `partSnapshots` and
   `templateSnapshots` without validating their shape
   (`src/model/project-file.ts:120-124`). `.wwlib` imports are only checked for
   id/name/kind in `mergeItems` (`src/stores/libraryStore.ts:143-156`). A
   malformed device with a non-array `ports` can pass and crash a canvas
   render.
2. **Reference counting does not recurse into subassemblies** (§2.7), so a
   part used only inside a saved subassembly can be deleted.
3. **MCP path confinement does not resolve symlinks.** `inRoot` compares
   resolved paths (`scripts/mcp-server/index.ts:30-40`) but a symlink inside
   the root can still point outside it. The `.wwv`-only restriction limits the
   impact.
4. **MCP mutation payloads are loosely validated** (§2.10). This is not a
   security boundary in the same sense as IPC (the agent already has the
   project file), but it can produce corrupt projects.
5. **A corrupt revision blocks the whole open.** `parseProjectFile` recurses
   into each revision and requires device/harness arrays
   (`src/model/project-file.ts:132-154`); one malformed revision fails the
   project rather than being skipped and reported.

---

## 6. Recommended order of work

### P0 — correctness and CI

1. **Make E2E green.** Import `PROJECT_SCHEMA_VERSION` in
   `tests/e2e/dialogs.test.ts` instead of hard-coding 2. This is a one-line
   fix and unblocks the cross-platform E2E job.
2. **Fix cable quantities in BOM and cutlist.** Decide whether a cable is one
   part with N conductors or N individually purchased wires; encode that in
   the model (a cable instance/group) and make both reports agree. Add a test
   for a 4-core cable laid once.
3. **Union splice members in the netlist** and add a netlist test with a
   splice.
4. **Enforce the one-port-one-harness invariant in `api.createHarness`**, or
   route it through `addEndpoint`/`planConnection`. Remove or redesign
   `duplicateHarness`.
5. **Validate part/template snapshots and `.wwlib` records on load** with the
   same rigour as harnesses, and skip/report malformed revisions rather than
   failing the whole file.

### P1 — make promised features reachable

6. Add UI for connector `currentRatingAmps` and `PinDef.maxCurrentAmps`;
   expose `isPlaceholder` (or remove the placeholder scaffolding).
7. Add endpoint removal (and optionally reordering) to the Harness Inspector
   or editor, using the existing `ops.removeEndpoint`.
8. Make accessory assignment per-endpoint where it matters, add an accessory
   part kind, and include mating connectors in the BOM.
9. Finish or clearly bound subassemblies: expose boundary ports, populate
   `exposedPorts`, and recurse through subassemblies in references/snapshots.
10. Fix WireViz import (`pinlabels`, `connections`, template sizing) and export
    (striped colours, shields, twists, labels).
11. Add bundle/segment label export and correct the documentation that claims
    it exists.
12. Complete the report pack: accessories/splices sections, formboard in
    HTML/PDF, and a fit-to-extents capture for the diagram.
13. Gate every project shortcut on "not typing" (or at least the destructive
    ones) and route native menu Undo/Redo through the same context checks.
14. Keep parsed library records on a partial read error, or make "Continue and
    save" reload them; use `mergeItems` in the reconciliation dialog.
15. Sync the README, in-app documentation and roadmap with the current code.

### P2 — scale and polish

16. Virtualise Reports tables (Virtuoso) and consider
    `onlyRenderVisibleElements` in the Harness Editor.
17. Add an id index for `DeviceNode` lookups and share one assembly validation
    pass.
18. Revisit revision UX (description, delete, deeper diff) and the MCP update
    tools.
19. Improve formboard collision handling and provide a print-friendly light
    theme for its SVG/PDF output.
20. Make the harness editor's multi-endpoint layout (handle sides) comfortable
    for three or more endpoints.

---

## 7. What is working particularly well

- **The model layer.** `src/model` is pure, immutable, framework-free and
  carries most of the tests. `ops.ts` is a clean mutation surface shared by the
  store and the API, and no-op edits preserve object identity.
- **Data safety.** Per-record atomic library writes, corrupt-record
  quarantine, unique temp files, single-instance locking, path grants and
  recovery autosave are real, working safeguards rather than slideware.
- **The library surface.** Virtualised lists, fuzzy search, per-record storage,
  packs, imports and an explicit in-use deletion policy are coherent.
- **The overlay/focus stack.** One overlay manager for z-order, Escape and
  focus fixed a class of bugs that used to be pervasive.
- **Performance baseline.** The DRC worker with debounce and a shared result,
  the effective-library cache and per-record writes keep the model fast at
  thousands of wires.
- **The test suite.** 294 unit tests pass quickly and cover the model, stores,
  formats and reports well; 15 of 16 E2E flows pass, including native-dialog
  save/open, exports and pack install.

---

## 8. Not verified

- macOS and Windows runtime behaviour; the E2E failure was reproduced on
  Linux, and the assertion is platform-independent.
- Packaging/installers, code signing/notarisation, and the packaged
  `data/` packs.
- Real 1:1 printing and label-printer output.
- The 2,698-part library UI after the current per-record changes; prior
  reviews measured that path, but this pass used synthetic model benchmarks
  and an 80-device app run.
- Concurrent-write and power-loss behaviour beyond the code-level analysis of
  the atomic-write path.
- MCP interoperability against a real MCP client; the server was reviewed
  statically and the tool count/schema inspected.
