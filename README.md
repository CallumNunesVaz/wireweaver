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
npm test           # Vitest unit tests (model/derivation invariants)
npm run package    # build + electron-builder installers (config TBD)
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
import/export. See `tests/api.test.ts` for runnable examples.

The same API backs an MCP server (42 tools: parts/templates, devices, harness CRUD,
pin-level wiring, validation, reports, revisions) for AI agents:

```bash
npm run mcp -- --help                      # usage
npm run mcp -- path/to/project.wwv         # load a project, then speak MCP on stdio
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
  and labels; connect two ports to create a harness; `isValidConnection` blocks
  same-device and already-occupied ports (one harness per port, v1). Custom `HarnessEdge`
  shows name, wired/partial/unwired/invalid status, and wire count. Hover highlights
  endpoints. Auto-layout (dagre). Delete + undo/redo.
- **Harness Editor** — full-screen overlay with a second React Flow instance: a pin column
  per end (derived from the ports' pinout templates), pin handles colored by signal class,
  drag pin→pin to wire. **Auto-wire by signal name**, clear all, and per-wire part/colour
  assignment. Live validation (signal-class mismatch, orphaned pins).
- **Persistence** — library saved to `<userData>/library/{parts,pinout-templates}.json`
  (debounced, atomic writes); images content-addressed under `images/`. Projects save to
  `.wwv` JSON via native dialogs, embedding part/template snapshots for portability.
- **BOM export** — CSV of devices, derived connectors (two per harness), and assigned wire
  parts with quantities, unit cost, and weight.

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
over `ww://image/<full|thumb>/<hash>` so Chromium caches them natively; ≤128px WebP
thumbnails are generated at import and used by library cards and canvas nodes, with the
`thumb` variant falling back to the original for older imports. The renderer runs with
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Known follow-ups (not yet done)

- **Bundled content packs**: the Packs browser and the `data/` packaging hook exist, but
  `data/` is gitignored, so the `.wwlib` packs must be regenerated (`scripts/import-*`) or
  committed before a packaged build ships them.
- **Part-vs-snapshot reconciliation diffing**: snapshots are written on save and merged in
  on open when the library lacks them, but a "this part differs from the library"
  review/merge UI is not built.
- **Subassemblies** are saved reusable harnesses matched to placed devices by port id;
  true nested-assembly instantiation (a subassembly as a device owning its own internal
  wiring) is not implemented.
- **UI tests**: model/store/API logic is covered by Vitest; canvas interactions rely on
  the opt-in Playwright smoke test (`WW_E2E=1`, requires Playwright and a build).
- **FX conversion** is offered in the Reports modal; the BOM CSV still sums per currency.
