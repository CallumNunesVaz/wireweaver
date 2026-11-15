# WireWeaver — Software Review

Reviewed at commit `ce53e8e` (main), 15 Nov 2026. Scope: Electron main and preload, the React renderer, the pure model layer, the MCP server, build and CI.

## Verdict

WireWeaver has a sound core and an unfinished shell. The model layer is pure, well tested and worth keeping as is. The Electron security baseline is better than most apps at this stage. The front-end is where the product falls down: it looks coherent in screenshots, but three everyday actions crash the canvas, the library panels clip content they cannot scroll to, and two parallel implementations of the library editor disagree with each other.

Nothing here needs a rewrite. The crashes share one root cause and are a few lines each. The larger work is consolidating the overlay, editor and library-list code that has been written two or three times.

| Area | Grade | One-line reason |
|---|---|---|
| Front-end (correctness and UX) | C | Reproducible crashes, clipped panels, duplicated and inconsistent flows |
| Look and feel | B− | Coherent dark theme; light theme and small text are second-class |
| Security | B− | Good sandbox/CSP baseline; IPC trusts the renderer with paths; end-of-life Electron |
| Stability and data integrity | C | Crashes above, plus silent library-loss paths |
| Performance and scalability | C+ | Fine at seed scale; degrades with the app's own bundled wire pack |
| Modularity | C+ | Excellent model layer; renderer has 1,300–1,400-line components and three copies of several flows |
| Front/back/feature consistency | C | The app and the "single source of truth" API are separate implementations |

## How this was reviewed

- Read all of `electron/`, `src/stores`, `src/app`, `src/assembly`, `src/harness`, `src/library`, `src/inspector`, `src/reports`, `src/shared`; sampled `src/model` and `scripts/mcp-server`.
- `npm run typecheck` passes. `npm test` passes: 210 tests, 4 skipped (the opt-in Playwright smoke test). `npm run build` passes.
- Drove the built app with Playwright against an isolated config directory, using a three-device test project and then a library of 2,698 parts (the seed library plus the bundled Tensility and JST packs).

Findings below are marked **[confirmed]** when reproduced in the running app and **[code]** when they come from reading the source only.

## 1. Front-end

### 1.1 Crashes (fix first)

All three are Rules-of-Hooks violations: a component returns early and then calls a hook further down. When the object it renders disappears, React throws "Rendered fewer hooks than expected" (minified error #300) and the error boundary replaces the canvas with "Something went wrong".

| # | Trigger | Where | Status |
|---|---|---|---|
| F1 | Right-click a device → Delete | `src/assembly/DeviceNode.tsx:39` returns before the `useMemo` at line 47 | **[confirmed]** |
| F2 | New project (Ctrl+N or menu) with any device on the canvas | Same code path as F1 | **[confirmed]** |
| F3 | Ctrl+N while the Harness Editor is open | `src/harness/HarnessEditor.tsx:725` returns before the `useMemo` at line 741 | **[confirmed]** |

The same path is very likely hit by the Inspector's delete button, by undoing "add device", and by opening a different project over a populated canvas: each removes an instance from the store while its node is still mounted. The Delete key does not crash, because React Flow removes the node in the same batch.

"Retry" does recover the canvas, so no data is lost, but a user's first attempt at "New project" ends in an error screen.

A fourth violation is latent: `src/harness/SpliceNode.tsx:16` calls `useLibraryStore` conditionally. Assigning a wire to a splice did not crash in testing, because React tolerates going from zero hooks to one, but it is the same class of bug.

**Decision:** move every hook above the early return in these three files, and add `eslint-plugin-react-hooks` to CI. The repository has no linter at all, which is how four of these got in.

### 1.2 Broken or dead-end interactions

- **Library panels clip instead of scrolling. [confirmed]** `LibraryPane.tsx:119` and `LibraryManager.tsx:613` stack five sections, each up to 400px tall, in a container with no overflow. With 2,698 parts in a 900px window, the Wires section starts at y=795 and Subassemblies and Pinout Templates sit at y=1227–1497, unreachable. It already overflows with the seed library once one template is added (section bottom at 961px).
- **Section heights are wrong. [confirmed]** `LibraryPane.tsx:156` reserves 88px per card; cards are about 46px. Two devices leave an 85px blank gap. Cards also have no margin, so they touch each other and the pane edge.
- **"Open Harness Editor" in the Library Manager appears to do nothing. [confirmed]** The editor mounts at `z-30` underneath the manager at `z-50`. The manager's "New template" button has the same problem with the `z-40` template modal.
- **Templates cannot be created in the Library Manager. [confirmed]** After choosing a connector, zero pin rows appear: `TemplateDetail` (`LibraryManager.tsx:1193`) never sizes the pin list to the connector, and has no signal-class field. The standalone `PinoutTemplateEditor` does both correctly.
- **One Escape closes every stacked modal. [confirmed]** Each `Modal` adds its own window-level key listener (`Modal.tsx:13`). Opening "New template" from the part editor and pressing Escape closes both and discards the part draft. Clicking the backdrop also discards drafts with no prompt.
- **The `?` shortcut never fires. [confirmed]** `App.tsx:444` requires `e.key === '?' && !e.shiftKey`, which is impossible on most keyboard layouts.
- **A project cannot be renamed. [code]** Nothing in the UI calls `setProjectMeta({ name })`. Every project is "Untitled" in the header, in the Recent list, and in export file names.
- **Opening a project does not fit the view. [confirmed]** `fitView` runs once on the empty canvas; a loaded project appeared at roughly 2× zoom with devices under the Inspector.
- **Global shortcuts ignore context. [confirmed for Ctrl+N and Ctrl+Z]** The handler at `App.tsx:379` runs when a modal, the Harness Editor or a text field has focus. Ctrl+Z in any input undoes the project instead of the text; Ctrl+N, Ctrl+O, Ctrl+D and Ctrl+B all act on the project behind an open overlay.
- **Auto-layout creates one undo step per device. [code]** `AssemblyView.tsx:302` loops `updateInstancePosition`; the bulk `updateInstancePositions` already exists for this.
- **Splices are half-built. [confirmed visually, rest from code]** The splice node floats with no edges to its wires; its handles cannot be connected; dragging it does not persist (`HarnessEditor.tsx:277` writes a junk `layout['splice-…']` key while position is read from `sp.position`); names are random (`Splice a8Xk_2`).
- **Custom wire colour picker resets while in use. [code]** `ColorSwatchPicker` is declared inside `WireEditPopup` (`HarnessEditor.tsx:1266`), so it remounts on every parent render and loses its open state after each colour change.
- **Assigning a multi-core cable from the wire popup stacks strands on one pin pair. [code]** `assignWirePart` (`HarnessEditor.tsx:513`) copies the original wire's endpoints to every conductor.
- **Library folder dialog cannot be cancelled. [code]** In `LibraryManager.tsx:366` the cancel button is labelled "Switch", so Escape or a backdrop click switches the library.

### 1.3 Inconsistencies between screens

- **Two part editors.** The Library pane opens a draft-based modal and saves only on confirm. The Library Manager's `+` writes a blank, unnamed part straight to disk and then edits it; abandoning it leaves "(unnamed)" in the library.
- **Two deletion policies.** The pane disables Delete for a part that is in use. The manager offers "Delete anyway". An unused part is deleted with no confirmation in either, and the library has no undo.
- **Mixed click semantics.** Double-click edits a part or template; a single click on a subassembly card inserts a harness into the project.
- **Canvas action edits the shared library.** Dropping a template on a placed device adds a port to the library part, changing every instance in every project, with no undo.
- **Duplicate controls.** With wire filters open, the same `WireFilterBar` renders in both the manager header and its sidebar.
- **Stale documentation.** The README still describes "one harness per port" and "two connectors per harness"; the app now supports multi-endpoint harnesses. The `run-desktop` skill refers to a "Recent projects" button that no longer exists.

### 1.4 Look and feel

What works: a consistent dark palette driven by CSS variables, a clear three-pane layout, good empty states, a command palette, themed confirm and prompt dialogs, signal-class colour coding, and status-coloured harness edges with icons as well as colour.

What does not:

- **Light theme is partial.** 83 hard-coded hex colours (16 distinct values) in the components bypass the theme variables (`#14161b` handle borders, `#2f343f` edge-label borders, `#e5484d`, `#c48a2f`, the minimap mask). The DRC badge is amber-on-amber and nearly invisible in light mode. The window background is hard-coded dark, so light-theme users get a dark flash on launch. The theme does not follow the OS setting.
- **Text is too small.** The base size is 13px and much of the UI is 9–11px: port labels are 9px, pin signals 10px, card subtitles 10px.
- **Layout jumps.** The Inspector is hidden when nothing is selected, so the canvas resizes by 288px on every select and deselect. With the Library, Inspector and DRC panel all open at the 960px minimum width, the canvas is 96px wide.
- **Toolbars do not adapt.** The Harness Editor toolbar is a single unwrapped row that grows by one chip per endpoint pair. Most header buttons are icon-only with only a hover tooltip.
- **Feedback is terse.** Error toasts auto-dismiss after 4.5 seconds like success toasts. The crash screen shows a raw minified React message. The DRC footer shows an internal id fragment ("Target: instance i-s2…").
- **Window chrome is generic.** No application menu, and the native title never shows the project name or unsaved state.

### 1.5 Accessibility

There is effectively none yet. Modals have no `role="dialog"`, focus trap or focus restore. Menus have no roles or arrow-key navigation. Icon buttons have `title` but no `aria-label`. Toasts are not announced. Focus outlines are removed on inputs (`outline-none`) and replaced only by a border colour change. Creating a harness or a wire is mouse-drag only.

**Decision:** adopt Radix UI primitives (Dialog, DropdownMenu, ContextMenu, Tooltip) under the existing Tailwind styling rather than hand-building these. That fixes focus management, Escape layering and menu keyboard support in one move, and replaces five hand-rolled overlay implementations.

## 2. Security

### What is already right

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; a narrow preload bridge; a registered `ww://` scheme with a strict build-time CSP (`script-src 'self'`); path-traversal checks on `ww://app`; a hash-only filename pattern on `ww://image`; `setWindowOpenHandler` denying in-app windows; HTML escaping throughout the report generator; `basename()` on pack ids.

### Gaps

| # | Severity | Finding |
|---|---|---|
| S1 | High | **Electron 31.7.7 is end-of-life.** `npm audit` flags every Electron ≤ 42.11.15. Note that `npm audit --omit=dev` reports zero issues only because Electron is a dev dependency; it is the shipped runtime. Full audit: 27 advisories (2 critical, 12 high), the rest in build tooling. |
| S2 | Medium | **IPC handlers trust the renderer with filesystem paths.** `project:openPath` reads any path; `project:save` writes any path it is handed; `library:setPath` and `library:relocatePath` create directories and copy files anywhere (`electron/main/index.ts:322–353`, `562–592`). None validates its sender or its arguments. This is harmless until the renderer is compromised, at which point the sandbox no longer contains it. |
| S3 | Medium | **No navigation guard.** There is no `will-navigate` handler, so a navigation away from `ww://app` is not blocked. |
| S4 | Low | **`openExternal` checks `startsWith('http')`** rather than parsing the URL and allow-listing `http:` and `https:` (`index.ts:229`, `388`). |
| S5 | Low | **SVG uploads are stored and served as `image/svg+xml`.** Safe inside `<img>`, but S3 makes a direct navigation to one possible. Images have no size limit and travel as base64 over IPC. |
| S6 | Low | **PDF export** runs the report in a window with JavaScript enabled, from a predictable temp file name (`wireweaver-report-<pid>.html`). |
| S7 | Low | **CSV exports do not neutralise formula prefixes** (`=`, `+`, `-`, `@`). A part name from a shared library or project file can execute as a formula in Excel. |
| S8 | Low | **Opened files are not validated.** `.wwv` and `.wwlib` JSON goes straight into the stores. React escapes it, so this is a stability issue more than a security one (see 3). |
| S9 | Low | **MCP server reads and writes any path** the agent supplies, with no workspace root and non-atomic writes. |

**Decisions:**

- Upgrade Electron to a supported major and add a scheduled dependency-update job.
- Have the main process hand out opaque tokens for paths the user picked in a native dialog (and for recent-project entries it stored itself); `save` and `openPath` accept only those tokens. Validate `event.senderFrame` against `ww://app` in every handler.
- Block `will-navigate`, parse URLs in `openExternal`, reject SVG or rasterise it on import, disable JavaScript in the PDF window, and prefix risky CSV cells with `'`.
- Give the MCP server a `--root` and refuse paths outside it.

## 3. Stability and data integrity

- **A corrupt `parts.json` silently empties the library. [code]** `readJson` returns its fallback on any error (`index.ts:92`). The file exists, so the starter set is not seeded; the library loads empty, and the next edit overwrites the damaged file. A parse failure should be surfaced, and the bad file kept as `parts.json.corrupt`.
- **Concurrent writes share a temp file. [code]** `writeJsonAtomic` uses `<file>.<pid>.tmp`, so two overlapping saves of the same file race. There is no `fsync` before the rename.
- **Pending library writes can land in the wrong folder. [code]** Library saves are debounced by 500ms and resolve the path at write time; switching the library folder inside that window writes the old library's parts into the new folder.
- **Relocating a library overwrites the destination. [code]** `library:relocatePath` copies over any existing `parts.json` without checking.
- **No single-instance lock. [code]** Two windows rewrite the same library and recovery files, last writer wins.
- **`.wwv` is a registered file type that the app cannot open. [code]** `electron-builder.yml` declares the association, but the main process handles neither `open-file` nor a path argument.
- **Project files carry no schema version. [code]** Migration is an ad-hoc shape check in `ensureHarness`. A file missing `harnesses` throws on open; one missing `deviceInstances` crashes at render.
- **Closing offers only Discard or Cancel.** There is no Save option on the unsaved-changes dialog.
- **Error boundaries do not log or reset.** There is no `componentDidCatch`, and no reset key, so "Retry" re-renders the same state.
- **Crash recovery works** and is a good feature: rolling autosave, offered on next launch, cleared on save.
- **Tests cover the model, not the UI.** The 210 tests exercise model and store logic. None of the defects in section 1 is reachable by the suite; the Playwright smoke test is opt-in and not run in CI.
- **CI cannot produce a release build.** `data/` is git-ignored, so the bundled packs do not exist on a clean checkout (the README acknowledges this).

## 4. Performance and scalability

Measured on the built app with 2,698 library parts, which is what a user has after installing two of the seven bundled packs.

| Measurement | Seed library | 2,698 parts |
|---|---|---|
| Open Harness Editor | 54 ms | 734 ms |
| Wire cards rendered in the editor sidebar | 2 | 2,569 |
| Total DOM nodes with the editor open | 683 | 47,634 |
| Typing 5 characters in the harness name field | 62 ms | 364 ms |
| Library save payload per edit | 2 KB | 2.2 MB (38 ms round trip) |
| Typing 10 characters in library search | — | 162 ms |

- **The Harness Editor's wire list is not virtualised** (`HarnessEditor.tsx:894`), unlike the library pane. Each keystroke in the editor re-renders about 2,500 cards. The wire popup and bulk panel build equally long lists.
- **The whole library is one JSON file, rewritten on every edit.** It is serialised across IPC and written in full; at 2.2MB that is tolerable, but it grows linearly and there is no incremental path.
- **Design-rule check runs twice on the main thread** for every project change: once in `App.tsx:153` for the badge and again in `DrcPanel.tsx:30`.
- **`App` subscribes to the whole project**, so the entire shell re-renders on each edit.
- **Lookups are linear.** Every `DeviceNode` runs `parts.find` and `templates.find`; pack install is quadratic (a `find` plus an array copy per part).
- **Undo history stores up to 100 whole-project references.** Structural sharing keeps this cheap today; revisions embed full project copies inside the project file, which will not.
- **Selectors return fresh arrays** (`PartEditor.tsx:50`, `PinoutTemplateEditor.tsx:28`). This only costs re-renders on Zustand 4; it becomes an infinite loop on Zustand 5.
- **Canvas work is well done:** drag positions are batched per animation frame, nodes and edges are memoised, overlays are code-split, and vendor chunks are separated.

**Decisions:** virtualise the wire list; keep `Map` indexes of parts and templates in the library store; compute DRC once in a store selector (debounced, and in a worker once projects grow); store the library as one file per part or in SQLite so an edit writes one record.

## 5. Modularity

- **The model layer is the best part of the codebase.** `src/model` is pure TypeScript with no DOM, Electron or filesystem imports, and carries almost all the tests.
- **The renderer is not layered the same way.** `HarnessEditor.tsx` (1,437 lines) holds six components plus auto-wire and cable-deployment logic that belongs in the model. `LibraryManager.tsx` (1,323 lines) and `App.tsx` (701 lines) are similar.
- **Repeated code:**
  - five hand-rolled overlay shells (Modal, DialogHost, CommandPalette, LibraryManager, the Inspector's accessory modal), each with its own Escape and backdrop handling;
  - two part editors and two template editors;
  - three copies of "merge imported parts into the library";
  - three copies of the blank-part factory;
  - the same RAF drag-batching block in both canvases.
- **Layering by z-index is ad hoc** (30, 40, 50, 60, 65, 70 spread across files), which directly causes the hidden-editor bug.
- **The IPC contract is declared twice,** in `electron/preload/index.ts` and by hand in `src/ww.d.ts`, and the main process types payloads as `unknown`.
- **No linter or formatter is configured.**

**Decisions:** one overlay-stack manager that owns z-order and Escape (provided by the Radix adoption above); one `PartForm` and one `TemplateForm` used by both library surfaces; one shared, zod-validated IPC contract imported by main, preload and renderer; ESLint with the React Hooks plugin in CI.

## 6. Front-end, back-end and feature consistency

- **The app does not use its own API.** The README calls `src/model/api.ts` "the single source of truth shared by the app and the MCP server". Only the MCP server and tests import it. The renderer reimplements the same operations in `projectStore.ts` and inside components. Auto-wire, for example, exists in both `api.ts:583` and `HarnessEditor.tsx:413`, so the two can drift.
- **Two library models.** The app keeps a global library and treats a project's embedded snapshots as an import source. The MCP workspace keeps the library inside the project. A project written by the MCP server therefore opens in the app showing "missing device part" until the user accepts a reconciliation dialog that copies the parts into their global library. Editing a library part silently changes every project that uses it.
- **Project metadata is split.** Revision, author and description are editable only inside the Reports modal; the name is not editable anywhere.
- **Recent projects live in the library folder,** so switching library also switches the Recent list.
- **Reports capture the canvas with a CSS selector** (`.react-flow:not([style*="position: fixed"])`) rather than a reference to the view.

**Decisions:**

- Make `api.ts` the only mutation path. `projectStore` becomes a thin undo/dirty wrapper that calls it, and the Harness Editor's wiring logic moves into the model where the existing tests can reach it.
- Make projects self-contained: render from the project's own snapshots, and treat the global library as a catalogue to copy from, with an explicit "update from library" action. That removes the reconciliation step for files from other people and from the MCP server, and stops library edits from rewriting old designs.
- Add a schema version to `.wwv` and `.wwlib` and validate on load.

## 7. Recommended order of work

1. **Stop the crashes.** Fix the four hook-order violations; add ESLint with the hooks rule to CI. Small change, removes every confirmed crash.
2. **Make the library panels usable.** One scroll container, correct item heights, card spacing; virtualise the Harness Editor wire list.
3. **Introduce the overlay stack** (Radix). This fixes Escape layering, the hidden editor, focus handling and menu keyboard support together. Gate global shortcuts on "no overlay open and focus not in a text field"; fix `?`.
4. **Merge the duplicate editors** into shared forms; settle one deletion policy (block when in use, confirm otherwise); add project rename.
5. **Upgrade Electron** and apply the IPC, navigation and URL hardening in section 2.
6. **Protect user data:** surface library parse failures, unique temp files, single-instance lock, schema versions with validation, a Save option on close, `.wwv` open-with handling.
7. **Route the store through `api.ts`** and move to self-contained projects.
8. **Finish the light theme** by replacing hard-coded colours with tokens, raise minimum text size to 11px, and keep the Inspector column mounted to stop layout jumps.
9. **Run the Playwright smoke test in CI** and add cases for delete, new project, undo, and open-over-existing.
10. **Finish or hide splices** until they connect to wires.

## 8. Not verified

- Pack installation through the UI: the test launcher's app path made the packs folder resolve incorrectly, so pack timing was measured by preloading the library instead.
- Native dialogs (open, save, PDF export, the close prompt) and packaged installers were not exercised.
- macOS and Windows behaviour; all runtime checks were on Linux.
- Items marked **[code]** were not reproduced in the running app.

---

## 9. Status after fixes (branch `review-fixes`)

Verified with `npm run lint` (0 errors), `npm run typecheck`, `npm test` (228 passing), `npm run build`, and the new Playwright smoke test (`npm run test:e2e`, 8/8 against the built app), plus manual screenshots in both themes.

### Done

| Review item | What changed |
|---|---|
| F1–F3 crashes, latent splice hook | Hooks moved above early returns in `DeviceNode`, `HarnessEditor`, `SpliceNode`; the editor closes itself if its harness disappears. ESLint with `react-hooks/rules-of-hooks` now runs in CI. E2E covers context-menu delete, undo, and New over a populated canvas. |
| Library panels clip | Library pane and Library Manager are each one virtualised scroll list (headers, cards, empty states); no fixed-height sections; card spacing fixed. |
| Hidden editor, Escape closes everything, no focus handling | New overlay stack (`src/shared/overlay.ts`): z-order by open order, Escape closes only the top overlay, dialogs have `role="dialog"`, focus trap and restore; menus have roles and arrow-key navigation. Chosen over Radix to avoid a dependency and migrate every overlay in one pass. |
| Global shortcuts ignore context, `?` never fires | Shortcuts are gated on "no overlay open" and "not typing"; Ctrl+Z in a text field is native undo; `?` fixed; the assembly canvas's Delete key is disabled while an overlay covers it. |
| Template creation broken in Library Manager; two part/template editors; blank parts written to disk | One `PartForm` and one `TemplateForm` used by both surfaces; `+` opens an unsaved draft; unsaved edits prompt before being discarded. |
| Inconsistent deletion | One policy in `libraryActions.ts`: in-use items can't be deleted (with where-used), unused items ask first; bulk delete skips in-use items. |
| No project rename | Click the project name in the title bar, or "Rename project…" in the palette. Window title shows name and unsaved state. |
| Open doesn't fit view; auto-layout = N undo steps; drag = N undo steps | Fit on open; auto-layout and multi-node drags commit one undo step; nudge moves the whole selection. |
| Splices | Sequential names, persisted positions, fake handles removed; hovering a splice highlights its wires. |
| Colour picker resets; multi-core assign stacks strands | `ColorSwatchPicker` hoisted; assigning a cable makes the wire the next free conductor (`model/wiring.ts`). |
| Library folder dialog can't be cancelled | Explicit Copy / Use as-is / Cancel. |
| Template drop silently edits shared part | Prompt explains the library-wide effect before adding the port. |
| Light theme, hard-coded colours, translucent highlights never rendered | Tokens as RGB channels (Tailwind alpha now works), status/handle/mask tokens, all component hex removed (except physical wire colours and the standalone formboard SVG); theme follows OS; no dark flash on launch. |
| Small text, layout jumps | 11px minimum; Inspector column always mounted with an empty state. |
| Accessibility | Dialog semantics, focus management, labelled icon buttons and form fields, live-region toasts, visible `:focus-visible` rings. Harness creation remains mouse-only. |
| S1 Electron EOL | Electron 31 → 45. `npm audit --omit=dev`: 0. |
| S2 IPC trusts paths | Typed contract; sender check on every handler; path grants for projects and library folders. |
| S3–S7 | `will-navigate` blocked; URL parsing for external links; SVG rejected, 20 MB cap, `nosniff` + sandbox CSP on images; PDF window without JavaScript in a private temp dir; formula-safe CSV (`model/csv.ts`). |
| S8 file validation | `schemaVersion` + validation/migration for `.wwv` and `.wwlib` (`model/project-file.ts`), used by app, recovery, API and MCP. |
| S9 MCP paths | `--root` / `WW_ROOT` confinement, `.wwv` only, atomic writes. |
| Stability items | Corrupt library is quarantined and reported, writes paused until resolved; unique temp files + `fsync`; pending writes flushed before switching library folder; relocate backs up destination files; single-instance lock; `.wwv` open-with (argv, second instance, macOS `open-file`); Save / Don't Save / Cancel on close and on New/Open; error boundaries log, reset on project change, and show a readable message; error toasts persist. Recent projects moved out of the library folder. |
| Performance | Harness Editor with 2,698 parts: open 734 → 85 ms, DOM nodes 47,634 → 707, typing 364 → 55 ms. DRC computed once per change and shared; App no longer re-renders on every edit; memoised id indexes; linear pack/import merge; searchable wire pickers capped at 50 rows. |
| Modularity / consistency | `HarnessEditor` split (`WirePanels.tsx`); `App` split (`TitleBar`, `ProjectWatcher`, `projectActions`, `useTheme`); shared RAF drag hook; wiring logic shared by app and `api.ts`; effective library renders projects from other machines and the MCP server without importing. |

### Deliberately not done (follow-ups)

- **Fully self-contained projects** (snapshot-first with "update from library"): would change the edit-part workflow; the effective library covers the rendering/reporting half.
- **Routing every `projectStore` mutation through `api.ts`**: only wiring, file formats and splice naming are shared so far.
- **Per-record library storage** (SQLite / one file per part) and **DRC in a worker**.
- **Keyboard-only harness/wire creation**.
- **Build-tool majors** (Vite 8, Vitest 4, electron-vite 6) for the remaining dev-only advisories.
- **Bundled packs in git / CI release builds** (`data/` is still ignored).

## 10. Follow-ups delegated to DeepSeek (15 Nov 2026)

Four §9 follow-ups plus the toolchain upgrade were implemented by DeepSeek V4 Pro on separate branches, then reviewed, amended where needed, verified, and merged. Each has a review record in `docs/reviews/`.

| Follow-up | Result |
|---|---|
| Store ↔ API duplication | Done — `src/model/ops.ts`; amended: API now rejects ports owned by another harness, no-op edits no longer mark the project dirty |
| Per-record library storage | Done — one file per record, migration verified on a 2,698-part library; amended: failed writes are requeued, not lost |
| DRC off the main thread | Done — Web Worker for 300+ wires; amended: shared result cache, worker kept for the session |
| Keyboard-only harness/wire creation | Done — `C` / `W` dialogs; amended after keyboard-only testing: sensible preselection and focus |
| Build-tool majors | Done — Vite 8, Vitest 4, electron-vite 6; `npm audit` 30 → 12 moderate (dev-only) |

Still open, by choice: fully self-contained projects (a UX decision) and committing the `data/` packs.
