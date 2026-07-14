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

- Library list **virtualization**, `electron-builder` packaging config, and a Playwright
  smoke test (per plan M5).
- Multi-branch harnesses, part-vs-snapshot **reconciliation UI** (snapshots are written on
  save and merged in on open when the library lacks them, but "part differs from library"
  diffing is not built).
- FX currency conversion (BOM totals are summed per currency).
