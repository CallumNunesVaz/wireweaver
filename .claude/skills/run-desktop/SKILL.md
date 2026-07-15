---
name: run-desktop
description: Build, launch, and drive the WireWeaver Electron app with real mouse/keyboard via Playwright — for verifying UI changes, taking screenshots, or reproducing bugs. Use when asked to run the app, test a flow end-to-end, or see a change working.
---

WireWeaver is an Electron + React (React Flow) desktop app. Agents drive the
real app through Playwright's `_electron` API using the helpers in
`driver.mjs` (same directory). Screenshots are the feedback loop: **take one
after every meaningful step and actually look at it.**

## Prerequisites

```bash
cd <repo root>
npm i --no-save playwright-core   # keep package.json unchanged
npm run build                     # driver launches out/main/index.js
```

On this machine `DISPLAY=:1` (the user's desktop) is available and there is
**no xvfb or tmux** — the app window appears on the user's screen while you
drive it, which is a feature: they can watch. On a headless box install xvfb
and wrap the run in `xvfb-run -a`.

## Running a scripted flow (primary pattern)

Write a flow file in the scratchpad that imports the driver:

```js
import { launch, helpers, closeApp, sleep } from '<repo>/.claude/skills/run-desktop/driver.mjs'

const { app, page } = await launch({
  recent: [{ name: 'My Test', path: '/abs/path/to/test-project.wwv' }]
})
const h = helpers(page)

await h.clickTitle('Recent projects')   // header buttons all have title=
await sleep(400)
await h.clickText('My Test')            // open project WITHOUT a native dialog
await sleep(2000)
await h.ss('loaded')
// ... drive, screenshot, verify ...
await closeApp(app, page)               // NOT app.close() — see gotcha 5
```

Run it: `node flow.mjs` (add `dangerouslyDisableSandbox` if sandboxed shells
block X11). `node driver.mjs` alone gives a stdin REPL with the same commands.

`launch()` isolates the app: `XDG_CONFIG_HOME=/tmp/ww-uitest-config` so the
user's real library/recents are never touched. Test projects should carry
`partSnapshots`/`templateSnapshots` so they are self-contained (snapshots are
merged into the sandboxed library on open).

## Helper semantics (hard-won — don't rediscover)

- **`drag(fromSel, toSel)`** — real mouse drag; required for every React Flow
  connection (assembly port→port, editor pin→pin). Handle selectors:
  - assembly: `.react-flow__handle[data-nodeid="<instanceId>"][data-handleid="<portId>"]`
    (target variant: `<portId>-tgt`)
  - harness editor: `data-nodeid="end-<a|b|c…>"`, `data-handleid="<end>:<pin>"`
    (target: `<end>:<pin>-tgt`)
- **`pathPoint(sel, frac)`** — clicking edges/wires MUST use this
  (`getPointAtLength` + `getScreenCTM`); bounding-box centers miss curves.
- **`center()`/`probe()`** — verifies with `elementFromPoint` before pressing.
  Ports stack an invisible target handle *behind* the visible source dot on
  purpose; any handle at the point is accepted as valid.
- **`clickTitle` / `clickText`** — DOM clicks for buttons; every header action
  has a `title` attribute.

## Gotchas (each cost a failed run)

1. **Selecting anything opens the Inspector**, which overlays the right ~290px
   of the canvas and silently swallows drags/drops on handles under it.
   Deselect first (click empty pane) or check occlusion via `probe()`.
2. **Native dialogs are unscriptable** (Open/Save/PDF pickers, `window.confirm`,
   the dirty-close prompt). Open projects via the seeded Recent menu; don't
   test export *file writes* this way — stop at the button.
3. **Short wires vs the wire popup**: the wire-edit popup opens at the click
   point and is ~245px wide; at fit-view zoom wires between adjacent columns
   are shorter than that. Zoom first — React Flow zooms toward the cursor:
   `page.mouse.move(<gap>); page.mouse.wheel(0, -300)` a few times.
4. **Two-wire selection (twisted pairs)**: click one wire, then the other —
   clicking a second wire adds to the selection (the popup stays open when the
   mousedown lands on another `.react-flow__edge`).
5. **Never call `app.close()` directly — use `closeApp(app, page)`.** After any
   edit the project is dirty, and closing a dirty app pops a NATIVE "Unsaved
   changes" dialog that hangs on the user's screen until a human dismisses it
   (your script will still print DONE and exit — you won't notice). `closeApp`
   clears the dirty flag over IPC first so the dialog never appears. If a run
   crashes mid-flight, kill strays: `pkill -f "electron out/main/index.js"`.
6. **Rebuild before driving** (`npm run build`) — the driver runs the built
   `out/`, not the Vite dev server, so stale builds test stale code.

## Verifying state

Prefer reading the UI over trusting clicks: `h.text('.fixed table')` for modal
tables (Reports), `h.edgeIds()` to detect created wires/harness segments,
`document.querySelectorAll('.react-flow__edge-twisted').length` for
twisted-pair rendering, DRC badge via
`[title="Design rule check"]` textContent. Screenshot everything; a blank or
wrong frame is a failed step even when the click reported OK.
