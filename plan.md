# WireWeaver — Implementation Plan

WireWeaver (WW) is a fast, snappy desktop application (Electron) for building connection
diagrams: **devices** as nodes, **wire harnesses** as connections, laid out graphically in
an **Assembly View** built on React Flow. A **Library** manages reusable parts (devices,
connectors, wires) and **pinout templates**. Each harness has its own React Flow based
**Harness Editor** for pin-level wiring.

---

## 1. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Desktop shell | Electron | Required; distributes as desktop app |
| Build tooling | `electron-vite` (Vite + esbuild) | Fast HMR in dev, fast production builds |
| UI framework | React 18 + TypeScript (strict) | Required by React Flow; TS keeps the data model honest |
| Diagramming | `@xyflow/react` (React Flow v12) | Required; used for both Assembly View and Harness Editor |
| Icons | `lucide-react` | Required |
| State | Zustand (+ `zundo` middleware for undo/redo) | Minimal re-renders via selectors — key to snappiness; React Flow's own docs recommend it |
| Styling | Tailwind CSS | Fast to iterate, no runtime CSS-in-JS cost |
| Persistence | JSON files via main process (atomic writes), images as content-addressed files | Human-diffable project files, trivial backup/versioning; no native module build pain |
| Currency | `Intl.NumberFormat` + static ISO 4217 currency list | Formats any global currency without a heavy dependency |
| Packaging | `electron-builder` | Cross-platform installers |
| Testing | Vitest (model/store logic) + Playwright (smoke E2E) | Fast unit loop; E2E only for critical flows |

---

## 2. Process Architecture

```
┌────────────────────────── Electron Main ──────────────────────────┐
│  Window management · File IO (library, projects, images)          │
│  Native dialogs (open/save) · shell.openExternal for part links   │
└──────────────────────────────┬────────────────────────────────────┘
                        typed IPC bridge (contextBridge, invoke/handle)
┌──────────────────────────────┴────────────────────────────────────┐
│  Renderer (React)                                                 │
│  ┌───────────┐ ┌──────────────────┐ ┌───────────────────────────┐ │
│  │ Library    │ │ Assembly View    │ │ Harness Editor (overlay)  │ │
│  │ pane +     │ │ (React Flow)     │ │ (React Flow)              │ │
│  │ manager    │ │                  │ │                           │ │
│  └───────────┘ └──────────────────┘ └───────────────────────────┘ │
│            Zustand stores: library · project · ui                 │
└────────────────────────────────────────────────────────────────────┘
```

- **Security defaults:** `contextIsolation: true`, `nodeIntegration: false`, all file access
  through a small typed IPC API (`window.ww.*`).
- **Hyperlinks** (manufacturer/supplier part numbers) open via `shell.openExternal` — never
  in-app navigation.

### Storage layout

```
<userData>/library/
  parts.json              # all parts (devices, connectors, wires)
  pinout-templates.json   # all pinout templates
  images/<sha256>.<ext>   # embedded pictures, content-addressed, referenced by hash

<anywhere>/myproject.wwv  # project file (JSON): device instances, harnesses, wiring, layout
```

The library is global (shared across projects). Project files reference parts by ID and
embed a snapshot of referenced parts so a `.wwv` file still opens on a machine with a
different library (with a "part differs from library" reconciliation prompt as a later
enhancement). Writes are debounced (~500 ms) and atomic (write temp file, rename).

---

## 3. Data Model (TypeScript)

```ts
// ---------- Shared part properties ----------
type PartType = 'COTS' | 'MOTS' | 'Custom';

interface PartBase {
  id: string;                 // nanoid
  name: string;
  imageHash?: string;         // key into images/ store
  type: PartType;
  internalPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  manufacturerPartUrl?: string;   // hyperlink
  supplier: string;
  supplierPartNumber: string;
  supplierPartUrl?: string;       // hyperlink
  cost?: { amount: number; currency: string };  // ISO 4217, e.g. 'USD', 'AUD'
  weightGrams?: number;
  notes?: string;
}

// ---------- The three part kinds ----------
interface ConnectorPart extends PartBase {
  kind: 'connector';
  positions: number;          // pin count, e.g. 4 for JST GH 4-pos
  gender?: 'male' | 'female' | 'hermaphroditic';
  // Note: a connector part *defines the mating connector* — i.e. what a
  // harness must carry to plug into a device port using this connector.
}

interface WirePart extends PartBase {
  kind: 'wire';
  gauge?: string;             // e.g. '28 AWG'
  color?: string;
  conductors?: number;        // 1 for single wire; >1 for multicore/cable
}

interface DevicePart extends PartBase {
  kind: 'device';
  ports: DevicePort[];
}

interface DevicePort {
  id: string;
  name: string;                    // e.g. 'CAN A', 'USB'
  pinoutTemplateId: string;        // links port -> connector + signals
  side: 'left' | 'right' | 'top' | 'bottom';  // handle placement on the node
}

// ---------- Pinout templates (logical, not physical) ----------
interface PinoutTemplate {
  id: string;
  name: string;                    // e.g. 'CAN + Power (JST GH 4-pos)'
  connectorPartId: string;         // the physical connector this maps onto
  pins: PinDef[];
}

interface PinDef {
  position: number;                // 1-based pin position
  signal: string;                  // '5V', 'CAN_H', 'CAN_L', 'GND', 'NC', ...
  signalClass?: 'power' | 'ground' | 'data' | 'shield' | 'nc';  // for coloring/validation
}

// ---------- Project (assembly) ----------
interface Project {
  id: string;
  name: string;
  deviceInstances: DeviceInstance[];
  harnesses: Harness[];
  partSnapshots: Record<string, Part>;          // portability snapshot
  templateSnapshots: Record<string, PinoutTemplate>;
}

interface DeviceInstance {
  id: string;                 // React Flow node id
  partId: string;             // -> DevicePart
  label: string;              // instance name, e.g. 'Flight Controller #1'
  position: { x: number; y: number };
}

interface Harness {
  id: string;                 // React Flow edge id
  name: string;
  a: { deviceInstanceId: string; portId: string };   // endpoints; connectors and
  b: { deviceInstanceId: string; portId: string };   // pinouts are *derived* from ports
  wires: HarnessWire[];       // pin-level wiring, edited in Harness Editor
  lengthMm?: number;
}

interface HarnessWire {
  id: string;
  from: { end: 'a' | 'b'; position: number };  // pin position on that end's connector
  to:   { end: 'a' | 'b'; position: number };
  wirePartId?: string;        // optional physical wire part
  color?: string;
}
```

**Key invariant:** a harness never stores its own connectors/pinouts — they are always
derived from the device ports it connects (`port -> pinoutTemplate -> connectorPart`). If a
port's template changes, harness wiring is re-validated and orphaned wires are flagged.

---

## 4. UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Title bar: project name · save state · undo/redo · zoom      │
├───────────────┬──────────────────────────────────────────────┤
│ LIBRARY PANE  │              ASSEMBLY VIEW (React Flow)      │
│ [search…]     │                                              │
│ ▸ Devices     │    ┌─────────┐        ┌──────────┐           │
│ ▸ Connectors  │    │ Device  ●━━━━━━━━● Device   │           │
│ ▸ Wires       │    │  node   │ harness│  node    │           │
│ ▸ Pinouts     │    └─────────┘        └──────────┘           │
│               │                                              │
│ (drag cards → │   MiniMap · Controls · dot Background        │
│  onto canvas) │                                              │
├───────────────┴──────────────────────────────────────────────┤
│ Inspector panel (contextual: selected node / harness / part) │
└──────────────────────────────────────────────────────────────┘
```

- **Library pane** (left, collapsible): searchable, categorized part cards with thumbnail +
  name + IPN. Drag a device card onto the canvas to instantiate it. `+` button per category
  opens the part editor. Right-click card → Edit / Duplicate / Delete (delete blocked with
  explanation if part is in use).
- **Part editor** (modal or slide-over): all shared properties, image drop-zone/paste,
  currency picker, plus kind-specific fields. For devices: a port list editor (name, side,
  pinout template picker with inline "create new template"). For pinout templates: pick a
  connector part → a pin grid appears sized to its positions → type signal names.
- **Inspector** (bottom or right, contextual): shows selected device instance or harness
  summary (endpoints, connector parts required, wire count, validation warnings).
- **Assembly View:** custom `DeviceNode` (image thumbnail, label, port handles placed per
  `port.side` with port name labels); custom `HarnessEdge` (label = harness name, wired/unwired
  badge). Connecting two port handles creates a harness. Double-click or right-click →
  "Edit Harness" opens the Harness Editor.
- **Harness Editor** (full-screen overlay with its own React Flow instance): connector A's
  pins as a node column on the left, connector B's on the right; each pin is a handle with
  position number + signal name + signal-class color. Drag pin→pin to create a wire.
  Toolbar: **Auto-wire by signal name**, clear all, assign wire part/color to selection,
  harness name + length fields. Esc or Done returns to Assembly View.

### Interaction & "snappy" details

- **Drag & drop** from library to canvas (HTML5 DnD → `screenToFlowPosition`).
- **Highlighting:** hovering a harness highlights both endpoint ports; hovering a device
  dims unrelated elements; incompatible drop/connection targets shown red during a drag
  (`isValidConnection`); pins already wired in the Harness Editor glow, unwired pins on a
  "wired" harness get a warning tint.
- **Automation:** auto-wire matching signal names across a harness; auto-suggest harness
  name (`<DeviceA>-<DeviceB>`); auto-layout button (dagre/elk) for the assembly; signal
  mismatch warnings (e.g. `5V` wired to `CAN_H`) surfaced in the inspector.
- **Keyboard:** Delete, Ctrl+Z/Shift+Ctrl+Z, Ctrl+D duplicate, Ctrl+F focus library search,
  Esc closes overlays, arrow-key nudge.

---

## 5. State Management

Three Zustand stores:

- **`libraryStore`** — parts + pinout templates, CRUD actions, persisted via IPC (debounced).
- **`projectStore`** — device instances, harnesses, wiring; wrapped in `zundo` temporal
  middleware for undo/redo; owns React Flow `onNodesChange`/`onEdgesChange` handlers;
  persisted to the open `.wwv` file (debounced autosave + explicit Ctrl+S).
- **`uiStore`** — selection, open overlay (harness editor / part editor), library filter,
  transient hover state. Never persisted; kept separate so hover/selection churn doesn't
  invalidate persistence or undo history.

React Flow nodes/edges are **derived** from `projectStore` (instances + harnesses) and
memoized; node components subscribe only to their own slice.

---

## 6. Performance Checklist (bake in from day one)

- All custom node/edge components wrapped in `React.memo`; Zustand selectors with shallow
  equality — no top-level "pass the whole store down" props.
- `onNodesChange` applies drag deltas without touching undo history until drag-end
  (coalesce moves into one undo step).
- Images: store originals, generate small thumbnails (≤128 px WebP) at import time; library
  cards and device nodes use thumbnails only; full image lazy-loaded in the part editor.
- Library list virtualized (`react-virtuoso` or simple windowing) once it grows.
- Persistence debounced and off the interaction path (IPC to main, atomic write there).
- `will-change`/transform-based animations only; no layout-thrashing CSS.
- Target: 60 fps drag with 100+ nodes; cold start < 2 s.

---

## 7. Milestones

### M0 — Scaffold (½ day)
- `npm create @quick-start/electron` (electron-vite, React + TS template).
- Add Tailwind, Zustand, `@xyflow/react`, `lucide-react`, `zundo`, `nanoid`, Vitest.
- Typed IPC bridge skeleton (`window.ww`), strict TS config, ESLint + Prettier.
- Empty three-pane layout renders; React Flow canvas with background/minimap/controls.

### M1 — Data model & persistence (1 day)
- All types from §3; Zustand stores; IPC handlers for library load/save, image
  import (hash + thumbnail), project open/save/save-as with native dialogs.
- Unit tests for model invariants (harness derivation, wiring validation).

### M2 — Library manager (2 days)
- Library pane: categories, search, cards with thumbnails.
- Part editor for all three kinds (shared properties form: image, type, IPN, manufacturer +
  hyperlinked MPN, supplier + hyperlinked SPN, cost with currency picker, weight).
- Pinout template editor: connector picker → pin grid → signal names + classes.
- Device port editor: add/remove/reorder ports, assign side + pinout template.
- Delete protection (in-use checks), duplicate action.

### M3 — Assembly View (2 days)
- Drag device from library → instantiate node at drop point.
- Custom `DeviceNode` with per-side port handles; custom `HarnessEdge`.
- Connect ports → creates `Harness` with derived endpoints; `isValidConnection` blocks
  port-to-same-device and already-occupied ports (one harness per port for v1).
- Selection, delete, duplicate, undo/redo, inspector panel, hover highlighting.
- Auto-layout button (dagre).

### M4 — Harness Editor (2 days)
- Overlay with second React Flow instance: pin-column nodes for each end (derived from the
  ports' pinout templates), pin handles, wire edges.
- Manual pin→pin wiring; auto-wire by signal name; wire part/color assignment.
- Wiring validation (mismatched signal classes → warning badges here and on the assembly
  edge); wired/partial/unwired status shown on the harness edge in Assembly View.
- Entry via double-click and right-click → Edit on a harness edge.

### M5 — Polish & ship (2 days)
- Keyboard shortcuts, context menus throughout, empty states, error toasts.
- Project snapshotting of referenced parts; recent-projects list.
- BOM export (CSV: connectors, wires, devices, quantities, cost/weight rollup) — cheap win
  given the data model.
- Performance pass against §6 targets; `electron-builder` packaging for Linux/Win/mac.
- Playwright smoke test: create part → drop device ×2 → connect → wire harness → save →
  reopen.

### Deferred (post-v1 backlog)
- Multi-branch harnesses (>2 endpoints / splices).
- Library import/export & sharing; part-vs-snapshot reconciliation UI.
- Wire length/routing estimation, harness drawings export (PDF/SVG).
- Currency conversion rollups (v1 sums per-currency, no FX conversion).
- Multiple ports per harness end, shield/twisted-pair modelling.

**Total estimate: ~9–10 working days to a packaged v1.**

---

## 8. Proposed Repo Structure

```
wireweaver/
├─ electron/
│  ├─ main/           # window, menu, IPC handlers, file IO, image store
│  └─ preload/        # contextBridge typed API (window.ww)
├─ src/
│  ├─ app/            # App shell, layout, routing between views
│  ├─ assembly/       # AssemblyView, DeviceNode, HarnessEdge, auto-layout
│  ├─ harness/        # HarnessEditor, PinColumnNode, WireEdge, auto-wire
│  ├─ library/        # LibraryPane, PartEditor, PinoutTemplateEditor, PortEditor
│  ├─ inspector/      # contextual inspector panel
│  ├─ model/          # types, validation, derivation helpers (pure, unit-tested)
│  ├─ stores/         # libraryStore, projectStore, uiStore
│  └─ shared/         # UI primitives, currency utils, hooks
├─ tests/             # Vitest unit + Playwright e2e
├─ plan.md
└─ package.json
```
