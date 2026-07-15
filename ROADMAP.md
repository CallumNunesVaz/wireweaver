# WireWeaver Roadmap

Feature survey of comparable harness-design tools (July 2026) and the roadmap derived
from it. Existing WireWeaver capabilities are listed at the end so the gap analysis
stays honest.

## Competitive survey

### WireViz (open source, YAML → diagram)
- Text/YAML input, git-friendly, renders SVG/PNG via GraphViz
- Auto BOM; HTML export with diagram + BOM embedded
- Wire color standards (DIN 47100, IEC 60757, 25-pair, T568A/B), striped/banded wires,
  hex colors; AWG/mm² gauges
- Connection ranges (`1-4` auto-expands), pin labels or numbers, shield as wire `s`
- "Additional components" on a connector/cable (contacts, backshells, heatshrink…) with
  quantity multipliers feeding the BOM; BOM-only custom items
- Mating-connector documentation, loops (shorted pins), images with captions, notes,
  metadata/title-block fields

### RapidHarness (commercial, $219–299/mo)
- Real-time auto-drawn schematic; system-level design with reusable subassemblies
- 80M-part cloud library + generic placeholder parts for early design
- Rule checker (pin conflicts, common mistakes); design configurations
- Outputs: schematic, BOM, **wiring tables**, **cutlists**, bundle labels, **netlists**,
  assembly notes/callouts, PDF/Excel export
- Formboard drawings at 1:1 scale for the build bench
- Integrated versioning (immutable revisions, clone), org sharing/partnerships
- Known user pain points (from reviews): tedious per-termination contact entry, weak
  bulk editing, unreliable undo, cloud lock-in — areas WireWeaver can deliberately beat

### Splice CAD (desktop, modern)
- Drag-and-drop canvas, layout + schematic views, project-level connectivity
- Parts DB (90+ manufacturers) plus custom component/cable creators
- Splices as first-class objects; auto BOM; SVG/PNG/PDF export
- Built-in revision tracking/rollback; fuzzy search
- MCP server for AI-agent harness generation; Python API; web embed viewer

### EZ Wire / harness.design (motorsport-focused, ~$29/mo)
- 1,350+ connector library, 60+ pre-configured ECU/PDM pinouts
- Real-time error checking; intuitive web workflow
- Lesson: pre-built device libraries are the single biggest time-saver users cite

### WireCAD (AV/broadcast)
- Auto cable numbering unique across drawings; cable label printing
- Auto rack layouts, riser/ladder diagrams; ~80k community equipment library
- BOM with connector counts by type

### Enterprise tier (Zuken E3.series, Siemens Capital/VeSys, HarnWare, Arcadia)
- Full design-to-manufacturing: 2D schematic + 3D routing, automated wire sizing,
  length from routing, electrical rule checks (shorts, overcurrent), formboards,
  manufacturing docs. Out of scope for WireWeaver except the ideas noted below.

## Gap analysis → roadmap

### Phase 1 — Manufacturing documentation (highest value, builds on existing model)
Every competitor's core deliverable is paper for the build bench; WireWeaver currently
exports only a harness PNG and a project BOM CSV.
- [x] **Wiring table (from–to list)** per harness: wire id/label, from endpoint·pin·signal,
      to endpoint·pin·signal, color, gauge, length. Export CSV + show in-app.
      *(Reports modal → Wiring tab / Wiring CSV)*
- [x] **Cutlist**: aggregate wire part × gauge × color × cut length (segment lengths +
      configurable slack/strip allowance). *(Reports modal → Cutlist tab, slack input)*
- [x] **PDF/print export** with a title block (project name, revision, date, author,
      description) — the HTML report rendered to PDF, embedding the assembly diagram.
- [x] **Netlist export**: system-level electrical nets across harnesses (signal-name
      propagation through pins), for cross-checking against the schematic.
- [x] **HTML report export** (WireViz-style): self-contained file with diagram, BOM,
      wiring tables, cutlist and netlist — shareable without WireWeaver.

### Phase 2 — Design integrity & richer BOM
- [x] **Design rule check panel**: unterminated pins, missing wire parts, missing
      segment lengths, twisted-pair integrity, unresolved endpoints/parts, port-in-two-
      harnesses, signal-class mismatches. Live badge in the header + jump-to-issue.
      *(Gauge vs. connector current rating still open — needs a rating field on parts.)*
- [ ] **Splices** as first-class harness nodes (N wires joined mid-bundle), rendered in
      the harness editor and counted in the BOM.
- [ ] **Contacts & accessories per endpoint**: terminals/contacts, backshells, seals,
      heatshrink, loom as BOM line items with quantity multipliers (per-pin, per-wire,
      per-endpoint). Make bulk assignment one click — RapidHarness's worst UX pain.
- [x] **Wire labels**: user labels on wires (Harness Editor wire popup) with per-harness
      auto-numbering (W1, W2, …) in all reports. *(Bundle/segment labels and printer
      label-list export still open.)*
- [ ] **Striped/banded wire colors** (e.g. WH/GN) in swatches and codes.

### Phase 3 — Library & interoperability
- [x] **WireViz YAML export** per harness (Reports modal) — connectors, cables grouped
      per endpoint pair, pin-aligned connections, gauge/length/colors. *(Import still
      open.)*
- [ ] **Starter content packs**: common connector families (Deutsch DT, Molex Micro-Fit,
      JST, D-Sub, 8P8C) and popular ECU/PDM pinout templates as bundled `.wwlib`s —
      the most-cited time-saver in every review.
- [ ] **Fuzzy search + filters** in the Library (kind, manufacturer, pin count).
- [ ] **Generic placeholder parts** (n-pin connector, unspecified wire) that DRC flags
      until replaced — supports early-stage design.
- [ ] **Part lookup** via Octopart/Digi-Key API to pre-fill MPN, cost, datasheet link.

### Phase 4 — Advanced / differentiators
- [ ] **Reusable subassemblies**: save a harness as a library part, instantiate into
      projects, propagate updates (RapidHarness system-level design).
- [ ] **Project revisions**: named immutable snapshots with diff view (model is already
      plain JSON — snapshot + structural diff is cheap locally, no cloud lock-in).
- [ ] **Formboard view**: 1:1-scale printable board layout from segment lengths.
- [ ] **Electrical calculators**: ampacity check per gauge, voltage-drop estimate from
      length + current — motorsport users value this highly.
- [ ] **MCP server** exposing the project/library model so AI agents can generate and
      edit harnesses programmatically (Splice CAD precedent).

## Already in WireWeaver (don't re-implement)
Multi-endpoint harnesses; pin-level harness editor with twisted pairs, shields and
multi-conductor bundle fan-out; DIN/IEC/TEL/T568A/B color codes; AWG↔mm² conversion;
segment lengths; harness PNG export; BOM CSV with cost/weight totals; parts library
(devices/connectors/wires) with pinout templates, images and `.wwlib` import/export;
validation of orphan wires and wired-pin coverage; undo/redo; auto-layout.
