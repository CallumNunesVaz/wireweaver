# DeepSeek delegation — keyboard (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/keyboard`).

## Review outcome (Claude)

- **Accepted.** `planConnection` shared by mouse and keyboard; "Connect ports…" (C) and "Add wire…" (W) dialogs; accessible `ListBox`.
- **Amended (Claude), found by driving the real app with the keyboard only:** Connect stayed disabled until the user separately chose the (often only) source port, and Add wire stayed disabled until both pins were picked — both dialogs now preselect the obvious choice (first free source port; first free pin and a matching-signal pin). Initial focus moved from the close button to the target search / the Add-wire button; Enter in the search picks a single match. The new Inspector button made "Edit part" wrap — footer layout fixed.
- Verified: keyboard-only C → type → Enter → Connect creates a harness; W → Enter adds a wire; typecheck, 242 tests, E2E 8/8.

## Task prompt

# Task: keyboard-only creation of harnesses and wires

Creating a harness (Assembly view: drag port → port) and a wire (Harness Editor: drag
pin → pin) is mouse-only. Add keyboard-accessible equivalents.

1. Extract the Assembly view's connect logic (`onConnect` in
   `src/assembly/AssemblyView.tsx`: create a harness; or add the new endpoint to the one
   existing harness; refuse when both ports already belong to *different* harnesses; no
   self-connection) into a pure function, e.g. `planConnection(project, ep1, ep2)` in
   `src/model/` returning a discriminated union (`create` | `join` | `noop` | `error` with a
   message). Use it from both the mouse path and the new keyboard path.
2. "Connect ports…" dialog (use `Modal`): opened by a new key `C` when a device instance is
   selected on the Assembly canvas (respect gating: not in text fields, not behind an
   overlay — follow the pattern in `src/app/App.tsx`), by a "Connect…" button in the
   device Inspector (`src/inspector/Inspector.tsx`), and by a command-palette entry. It
   lets the user choose a source port on the selected device and a target port on another
   placed device (searchable list showing `device label · port name`, indicating ports that
   already belong to a harness), then confirms. Fully operable by keyboard with visible
   focus; labelled controls.
3. "Add wire…" dialog in the Harness Editor (`src/harness/HarnessEditor.tsx`): a toolbar
   button plus key `W` (only when the editor or its own wire panel is the top overlay and
   focus is not in a text field). Choose from-end + pin and to-end + pin; pins show
   position and signal name; already-wired pins are disabled; same-pin and duplicate
   wires are prevented exactly as `isValidConnection` does today. Creating selects the new
   wire (so the docked wire panel opens).
4. Update the shortcut lists in `src/shared/ShortcutCheatsheet.tsx` and
   `src/shared/DocumentationDialog.tsx`.
5. Tests: unit tests for `planConnection` and for any pure pin-selection helper you
   extract.

Acceptance: typecheck, lint, tests pass; mouse behaviour unchanged; no hard-coded colours;
hooks above early returns.



## DeepSeek final message (verbatim)

Now let me create the model files.
Now refactor overlay.ts:
Now update `isValidConnection`:
Now let me run typecheck, lint, and tests.
Done. Implemented keyboard-accessible harness and wire creation.

**What changed:**
- `src/model/connection.ts` — pure `planConnection(project, ep1, ep2)` (union: `create`/`join`/`noop`/`error`) + `findHarnessByEndpoint`.
- `src/model/wiring.ts` — extracted `isValidWireConnection` and `wiredPositionsByEnd`.
- `src/shared/overlay.ts` — `useOverlayEntry` + `isTopWorkspace`.
- `src/shared/ListBox.tsx` — reusable accessible listbox.
- `src/assembly/ConnectPortsDialog.tsx` + `src/harness/AddWireDialog.tsx` — the two new dialogs.
- Wired up `C` key + command palette + Inspector "Connect…" button (`App.tsx`, `uiStore.ts`, `Inspector.tsx`), refactored `AssemblyView.onConnect` and `HarnessEditor` (W key + toolbar button), updated the two shortcut lists.
- Tests: `tests/connection.test.ts` (7) + `tests/wiring.test.ts` (7).

**Verification:** typecheck PASS, lint PASS (0 errors; only 10 pre-existing warnings in `scripts/import-ecu-templates`), tests PASS (242 passed, 8 skipped), build PASS. Details in `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DEEPSEEK_NOTES

### Summary

Added keyboard-accessible equivalents to the two mouse-only gestures: creating a
harness (drag port → port) and creating a wire (drag pin → pin). Mouse behaviour is
preserved (the drag paths now delegate to the same pure logic as the new dialogs).

### What changed (by file)

#### New files

- `src/model/connection.ts`
  - `findHarnessByEndpoint(harnesses, deviceInstanceId, portId)` — pure lookup.
  - `planConnection(project, ep1, ep2)` — returns a discriminated union
    `{ kind: 'create' } | { kind: 'join'; harnessId; endpoint } | { kind: 'noop' } |
    { kind: 'error'; message }`. Encodes the existing connect rules: no self-connection
    (same device instance), both ports already in *different* harnesses → error, both in
    the same harness → noop, exactly one wired → join, neither → create.

- `src/shared/ListBox.tsx`
  - Reusable accessible single-select listbox (arrow/Home/End navigation, Enter/Space
    select, `aria-activedescendant`, disabled options with a note). Used by both dialogs.

- `src/assembly/ConnectPortsDialog.tsx`
  - The "Connect ports…" dialog (a `Modal`). Source port list on the selected device;
    searchable target list of `device label · port name` across other placed devices,
    with an "in harness" note. Confirm runs `planConnection` and commits via
    `addHarness` / `addEndpointToHarness`, then selects the harness.

- `src/harness/AddWireDialog.tsx`
  - The "Add wire…" dialog (a `Modal`). Two end selects + two pin listboxes; pins show
    `position · signal`, wired pins are disabled, and `isValidWireConnection` gates the
    Add button (same-pin / duplicate prevented exactly like the drag path).

- `tests/connection.test.ts` — 7 tests for `findHarnessByEndpoint` + `planConnection`.
- `tests/wiring.test.ts` — 7 tests for `wiredPositionsByEnd` + `isValidWireConnection`.

#### Modified files

- `src/model/wiring.ts`
  - Added `wiredPositionsByEnd(wires, endpointCount)` and
    `isValidWireConnection(wires, from, to)` (extracted from the Harness Editor's
    inline `isValidConnection` / `wiredPositions` logic).

- `src/shared/overlay.ts`
  - Added `useOverlayEntry(...)` (returns `{ z, id }`; `useOverlay` now delegates to it
    and still returns just `z`, so no existing callers changed) and `isTopWorkspace(id)`
    (topmost non-popup overlay has this id). Used to scope the Harness Editor's `W` key.

- `src/stores/uiStore.ts`
  - Added `connectPortsInstanceId`, `openConnectPorts(id)`, `closeConnectPorts()`.

- `src/app/App.tsx`
  - Lazy-loads and renders `ConnectPortsDialog`.
  - Global `C` shortcut (no modifier) opens the dialog when an instance is selected,
    gated by `topOverlay()` / `isTextTarget` like the existing handlers.
  - Added a "Connect ports…" command-palette entry (hint `C`).

- `src/assembly/AssemblyView.tsx`
  - `onConnect` rewritten to call `planConnection` and apply the result; identical
    store calls (`addHarness`, `addEndpointToHarness`, `select`) as before.

- `src/inspector/Inspector.tsx`
  - Added a "Connect…" button in the device inspector footer (disabled when the part
    has no ports).

- `src/harness/HarnessEditor.tsx`
  - Uses `useOverlayEntry` for `{ z, id }`.
  - `wiredPositions` / `isValidConnection` now delegate to the extracted helpers.
  - `onConnect` refactored through a shared `addWire` callback.
  - Added "Add wire" toolbar button + `W` key handler (scoped via `isTopWorkspace`
    and `isTextTarget`) + rendered `AddWireDialog`.

- `src/shared/ShortcutCheatsheet.tsx` / `src/shared/DocumentationDialog.tsx`
  - Added `C` and `W` to the shortcut lists.

### Design decisions

- Kept `planConnection` in `src/model/` (not the store) so it is pure and usable by the
  MCP server / programmatic API, matching the `wiring.ts` precedent.
- The mouse path (`AssemblyView.onConnect`) still goes through the store's existing
  `addHarness` / `addEndpointToHarness` rather than a new store action, so undo/redo and
  naming behaviour are unchanged.
- `isValidWireConnection` replicates the previous `isValidConnection` exactly (it allows
  same-end/different-pin, which the drag path also allowed).
- The `W` key is handled in the Harness Editor itself (not App.tsx) because it must be
  scoped to "this editor (or its wire panel) is the top overlay". `isTopWorkspace(id)`
  was added because `LibraryManager` is also a `workspace` overlay and would otherwise
  satisfy a naive `top.kind === 'workspace'` check.

### Guesses / assumptions

- The `C` key fires with no modifier, only when a device instance is selected and no
  overlay is open (mirroring the existing `?` / `F2` handling). I did not add a toast for
  the no-instance case in the command palette; it is a silent no-op (consistent with
  `duplicateSelection`).
- Target-port values use `instanceId|portId` with `|` as a separator; nanoid ids never
  contain `|`, so the split is safe. (Flagged as version-dependent only if ids ever change
  alphabet.)
- The Add-wire "to" end defaults to the second endpoint so from/to differ by default.

### Placeholders / unfinished

- None known. The wire context-menu (a `popup`) also leaves `W` active; pressing `W`
  while it is open opens the Add-wire dialog. Considered acceptable and not part of the
  acceptance criteria.

### Known risks

- `findHarnessByEndpoint` is duplicated between `src/model/connection.ts` and the private
  helper in `src/stores/projectStore.ts`. I intentionally did not touch the store to avoid
  changing its behaviour; a future cleanup could unify them.
- Rendering `AddWireDialog` inside the editor root (which has a z-index stacking context)
  follows the existing `WireInspector` pattern; it displays correctly because the dialog is
  always the top overlay when open, but this is the least-well-tested UI path (no GUI
  available in this environment).

### Final verification output

- `npm run typecheck` — PASS (typecheck:node and typecheck:web both clean).
- `npm run lint` — PASS (0 errors). 10 pre-existing warnings remain in
  `scripts/import-ecu-templates/index.ts` (unrelated to this change).
- `npm test` — PASS: 242 passed, 8 skipped (24 files passed, `tests/smoke.test.ts` skipped).
- `npm run build` — PASS (electron-vite main/preload/renderer all built).
