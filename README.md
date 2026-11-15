# WireWeaver

A fast Electron desktop app for building connection diagrams: **devices** as nodes,
**wire harnesses** as connections, laid out in an **Assembly View** (React Flow). A
**Library** manages reusable parts (devices, connectors, wires) and **pinout templates**;
each harness has its own React Flow **Harness Editor** for pin-level wiring.

See [`plan.md`](./plan.md) for the full design.

## Run it

```bash
npm install
npm run dev        # electron-vite dev server + Electron window with HMR
```

Other scripts:

```bash
npm run build      # production bundle (out/main, out/preload, out/renderer)
npm start          # preview the production build
npm run typecheck  # strict TS across main + renderer
npm run lint       # ESLint (incl. react-hooks/rules-of-hooks)
npm test           # Vitest unit tests (model, stores, file formats)
npm run test:e2e   # Playwright smoke test against the built app (see tests/smoke.test.ts)
npm run package    # build + electron-builder installers
```

On first launch the library is empty, so WireWeaver seeds a small starter set (a Flight
Controller, a CAN sensor, a JST GH 4-pos connector, a 28 AWG wire, and a "CAN + Power"
pinout template) so you can try the flow immediately.

## Programmatic API & MCP

`src/model/api.ts` is a pure, framework-free API for creating and editing harnesses
from code. It is the single source of truth shared by the app and the MCP server
(`scripts/mcp-server/index.ts`), and has no DOM/Electron/fs dependencies — hosts own
persistence.

```ts
import * as api from './src/model/api'

const ws = api.createWorkspace('Demo')
const conn = api.createConnectorPart(ws, { name: 'JST GH 4', positions: 4 })
const tpl = api.createPinoutTemplate(ws, {
  name: 'CAN + Power',
  connectorPartId: conn.id,
  pins: [
    { position: 1, signal: '5V', signalClass: 'power' },
    { position: 2, signal: 'CAN_H', signalClass: 'data' },
    { position: 3, signal: 'CAN_L', signalClass: 'data' },
    { position: 4, signal: 'GND', signalClass: 'ground' }
  ]
})
const fc = api.createDevicePart(ws, { name: 'FC', ports: [{ name: 'CAN A', pinoutTemplateId: tpl.id }] })
const sensor = api.createDevicePart(ws, { name: 'Sensor', ports: [{ name: 'CAN', pinoutTemplateId: tpl.id }] })
api.addDevice(ws, { partId: fc.id, label: 'FC' })
api.addDevice(ws, { partId: sensor.id, label: 'Sensor' })

// Create a harness, auto-wire matching signals, add a length.
const h = api.createHarness(ws, {
  name: 'CAN Bus',
  ports: [{ device: 'FC', port: 'CAN A' }, { device: 'Sensor', port: 'CAN' }]
})
api.autoWire(ws, h.id)
api.addSegment(ws, h.id, { from: 'a', to: 'b', lengthMm: 250 })

// Validate, report, and persist.
console.log(api.validate(ws))
console.log(api.wiringTable(ws), api.cutlist(ws, 50), api.netlist(ws))
fs.writeFileSync('demo.wwv', JSON.stringify(api.serializeWorkspace(ws), null, 2))
```

Wires can be addressed by `{ end, position }`, `{ deviceInstanceId, portId, position }`,
or `{ device, port, position }` (labels); referencing a new port auto-adds the endpoint.
The API also covers accessories, splices, subassemblies, revisions, BOM, and WireViz
import/export. See `tests/api.test.ts` for runnable examples. Auto-wiring, cable
deployment and conductor assignment live in `src/model/wiring.ts` and are shared by the
Harness Editor and the API, so the app and the MCP server behave identically.

The MCP server only reads and writes `.wwv` files inside its workspace root (the current
directory, or `--root` / `WW_ROOT`).

The same API backs an MCP server (43 tools: parts/templates, devices, harness CRUD,
pin-level wiring, validation, reports, revisions) for AI agents:

```bash
npm run mcp -- --help                      # usage
npm run mcp -- path/to/project.wwv         # load a project, then speak MCP on stdio
npm run mcp -- --root ./projects demo.wwv  # confine file access to ./projects
```

## What's in this prototype

- **Three-pane shell** — collapsible Library, Assembly View (React Flow with dot
  background, minimap, controls), contextual Inspector. Title bar with undo/redo, open,
  save, and BOM export.
- **Library** — searchable, categorized cards (Devices / Connectors / Wires / Pinout
  Templates). `+` per category. Device cards drag onto the canvas. Right-click a card for
  edit / duplicate / delete (delete of a placed device is blocked).
- **Part editor** — all shared properties (image drop-zone, type, IPN, manufacturer +
  hyperlinked MPN, supplier + hyperlinked SPN, cost with global-currency picker, weight)
  plus kind-specific fields. Devices get a port editor (name, side, pinout template).
- **Pinout template editor** — pick a connector part → a pin grid sized to its positions
  appears → set signal names + signal classes (colored).
- **Assembly View** — drag to instantiate; custom `DeviceNode` with per-side port handles
  and labels; connect two ports to create a harness, or connect a port to an existing
  harness to add an endpoint (multi-endpoint harnesses). Custom `HarnessEdge`
  shows name, wired/partial/unwired/invalid status, and wire count. Hover highlights
  endpoints. Auto-layout (dagre). Delete + undo/redo.
- **Harness Editor** — full-screen overlay with a second React Flow instance: a pin column
  per end (derived from the ports' pinout templates), pin handles colored by signal class,
  drag pin→pin to wire. **Auto-wire by signal name**, clear all, and per-wire part/colour
  assignment. Live validation (signal-class mismatch, orphaned pins).
- **Persistence** — library saved to `<userData>/library/{parts,pinout-templates}.json`
  (debounced, atomic writes); images content-addressed under `images/`. Projects save to
  `.wwv` JSON via native dialogs, embedding part/template snapshots for portability.
- **BOM export** — CSV of devices, derived connectors (one per harness endpoint), and
  assigned wire parts with quantities, unit cost, and weight. CSV cells that start with
  a formula character are neutralised.

**Key invariant:** a harness never stores its own connectors/pinouts — they are always
derived (`port → pinoutTemplate → connectorPart`). Validation flags orphaned wires if a
port's template later changes.

## Architecture

- **Main** (`electron/main`) — window, file IO, content-addressed image store, native
  dialogs, `shell.openExternal` for part hyperlinks. All renderer access goes through a
  typed IPC bridge.
- **Preload** (`electron/preload`) — `contextBridge` exposes `window.ww.*`
  (`contextIsolation: true`, `nodeIntegration: false`).
- **Renderer** (`src`) — React + TypeScript. Zustand stores: `libraryStore`,
  `projectStore` (wrapped in `zundo` for undo/redo), `uiStore` (transient, never
  persisted). Model + pure derivation/validation helpers live in `src/model` and are
  unit-tested.

## Security & serving

The packaged renderer is served over a registered `ww://app/` scheme (not `file://`),
which gives the app a real origin so a strict CSP (`script-src 'self'`, injected at build
time only — dev keeps Vite's inline HMR preamble) is enforced. Library images are served
over `ww://image/<full|thumb>/<hash>` with `nosniff` and a sandboxing CSP; only PNG, JPEG,
WebP and GIF are accepted (no SVG), up to 20 MB.

- **Process isolation** — `contextIsolation`, `sandbox`, no `nodeIntegration`, no
  `<webview>`; navigation away from the app is blocked and links open in the OS browser
  only for `http(s)` URLs. Electron is kept on a supported major (45).
- **Typed, checked IPC** — one contract (`src/ipc/contract.ts`) shared by main, preload
  and renderer. Every handler rejects senders other than the app window.
- **Path grants** — the renderer can only open or overwrite project files the user chose
  in a native dialog, picked from Recent, or opened from the OS; library folders only via
  the folder picker.
- **Data safety** — writes go through a unique temp file + `fsync` + rename. A corrupt
  library file is kept aside (`*.corrupt-<time>`) and reported instead of silently
  loading empty; library writes pause until you choose what to do. Relocating a library
  backs up anything already in the destination. Projects and libraries carry a
  `schemaVersion` and are validated on load (`src/model/project-file.ts`).
- **One instance** — a single-instance lock protects the library and recovery files; a
  second launch (e.g. double-clicking a `.wwv`) opens the file in the running window.
- **PDF export** renders the report in a hidden window with JavaScript disabled, from a
  private temp directory.

## Front-end architecture notes

- **Overlay stack** (`src/shared/overlay.ts`) — every modal, full-screen workspace, popup
  and menu registers here. Escape closes only the top-most overlay, z-order follows open
  order, dialogs trap and restore focus. Global shortcuts don't fire behind an overlay
  (except save and, in the Harness Editor, undo/redo) or while typing in a text field.
- **Effective library** (`src/stores/effectiveLibrary.ts`) — a project renders against
  your library with its own embedded snapshots filling any gaps, so projects from other
  machines or the MCP server display fully without importing anything first.
- **Theme tokens** live in `src/index.css` as RGB channels; components never hard-code
  colours. The theme follows the OS by default (cycle: system → light → dark).

## Known follow-ups (not yet done)

- **Bundled content packs**: `data/` is gitignored, so the `.wwlib` packs must be
  regenerated (`scripts/import-*`) or committed before a packaged build ships them.
- **Library storage** is one JSON file rewritten on each edit (~2 MB at 2,700 parts);
  per-record storage (SQLite or one file per part) would make edits O(1).
- **Fully self-contained projects** (snapshot-first, with an explicit "update from
  library") are not implemented; library edits still flow live into projects.
- **Store ↔ API**: wiring logic and file formats are shared with `api.ts`, but
  `projectStore` still has its own mutators rather than calling the API.
- **Subassemblies** are saved reusable harnesses matched to placed devices by port id;
  true nested-assembly instantiation is not implemented.
- **Build tooling**: Vite 5 / Vitest 2 / electron-vite 2 carry dev-only advisories; the
  upgrade to Vite 8 / Vitest 4 / electron-vite 6 is a separate migration.
- **FX conversion** is offered in the Reports modal; the BOM CSV still sums per currency.
