import { useState } from 'react'
import { Modal } from './Modal'
import { Cable, Link2, ShieldCheck, FileText, LayoutGrid, Search, Keyboard } from 'lucide-react'

type Section = 'overview' | 'assembly' | 'harness' | 'library' | 'docs' | 'drc' | 'shortcuts'

const TABS: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <Cable size={14} /> },
  { key: 'assembly', label: 'Assembly', icon: <LayoutGrid size={14} /> },
  { key: 'harness', label: 'Harness Editor', icon: <Link2 size={14} /> },
  { key: 'library', label: 'Library', icon: <Search size={14} /> },
  { key: 'docs', label: 'Manufacturing', icon: <FileText size={14} /> },
  { key: 'drc', label: 'DRC', icon: <ShieldCheck size={14} /> },
  { key: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} /> }
]

export function DocumentationDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('overview')

  return (
    <Modal title="WireWeaver Documentation" onClose={onClose} wide>
      <div className="flex gap-4" style={{ minHeight: 420 }}>
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-edge pr-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-left transition-colors ${
                section === tab.key
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-muted hover:text-ink hover:bg-panelalt'
              }`}
              onClick={() => setSection(tab.key)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto pr-1 text-xs leading-relaxed">
          {section === 'overview' && <OverviewSection />}
          {section === 'assembly' && <AssemblySection />}
          {section === 'harness' && <HarnessSection />}
          {section === 'library' && <LibrarySection />}
          {section === 'docs' && <ManufacturingSection />}
          {section === 'drc' && <DrcSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold border-b border-edge pb-1.5">{title}</h3>
      <div className="space-y-2 text-muted">{children}</div>
    </div>
  )
}

function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={className}>{children}</p>
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-accent/20 bg-accent/5 px-3 py-2 text-accent">
      {children}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-block rounded bg-panelalt border border-edge px-1 font-mono text-[11px]">
      {children}
    </kbd>
  )
}

function OverviewSection() {
  return (
    <div className="space-y-4">
      <Section title="What is WireWeaver?">
        <P>
          WireWeaver is a desktop application for designing and documenting wire harnesses.
          You place <strong>devices</strong> on a canvas, connect their ports to form{' '}
          <strong>harnesses</strong>, then wire individual pins together in the{' '}
          <strong>Harness Editor</strong>. WireWeaver derives connectors and pinouts from
          device port definitions — you never redefine connectors inside a harness.
        </P>
        <P>
          When your design is complete, WireWeaver generates manufacturing
          documentation: a bill of materials, wiring tables, cutlists, netlists, and
          self-contained HTML/PDF reports.
        </P>
      </Section>

      <Section title="Core Concepts">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-ink">Parts</h4>
            <P>Three kinds live in the Library:</P>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li><strong>Device</strong> — a component with ports (e.g. ECU, sensor).</li>
              <li><strong>Connector</strong> — a physical plug or receptacle with a pin count.</li>
              <li><strong>Wire</strong> — a wire or cable with gauge, color, and cost.</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-ink">Pinout Templates</h4>
            <P>
              A template maps signal names (5V, CAN_H, GND) and signal classes (power,
              ground, data, shield) onto a connector's pin positions. You assign a template
              to each port on a device.
            </P>
          </div>
          <div>
            <h4 className="font-medium text-ink">Device Instances</h4>
            <P>
              A device placed on the canvas. You can have multiple instances of the same
              device part — just drag it from the library again.
            </P>
          </div>
          <div>
            <h4 className="font-medium text-ink">Harnesses</h4>
            <P>
              A harness connects multiple device ports. It contains pin-level wiring between
              connectors (derived from the ports' pinout templates). Wires can be twisted
              into pairs, assigned physical wire parts, and given segment lengths.
            </P>
          </div>
          <div>
            <h4 className="font-medium text-ink">Key Invariant</h4>
            <P>
              A harness never stores its own connectors or pinouts — they are always
              derived from the device ports it connects. If you change a port's template,
              the harness re-validates and flags orphaned wires.
            </P>
          </div>
        </div>
      </Section>

      <Section title="File Format">
        <P>
          Projects save as <strong>.wwv</strong> files — plain JSON. They embed snapshots of
          all referenced library parts and templates, so a project is self-contained and
          portable between machines. On open, missing parts are offered for import into your
          local library.
        </P>
      </Section>
    </div>
  )
}

function AssemblySection() {
  return (
    <div className="space-y-4">
      <Section title="Assembly View">
        <P>
          The centre pane is the Assembly View — an interactive canvas built on React Flow.
          Here you arrange devices as nodes and connect their ports to create harnesses.
        </P>
      </Section>

      <Section title="Basic Workflow">
        <P>1. <strong>Create parts</strong> in the Library (devices with ports, connectors, wire parts, pinout templates).</P>
        <P>2. <strong>Drag a device</strong> from the Library onto the canvas to instantiate it.</P>
        <P>3. <strong>Connect ports</strong> — drag from a port handle on one device to a port handle on another. A harness is created automatically.</P>
        <P>4. <strong>Add more endpoints</strong> — drag from a free port to an existing harness's port. The harness grows into a star topology.</P>
        <P>5. <strong>Double-click</strong> a harness edge or press <Kbd>Ctrl+E</Kbd> to open the Harness Editor.</P>
      </Section>

      <Section title="Interaction">
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Drag</strong> nodes to reposition.</li>
          <li><strong>Click</strong> a node or edge to select it. The Inspector panel (right) shows details.</li>
          <li><strong>Ctrl+click</strong> multiple nodes for multi-selection. Alignment buttons appear in the toolbar.</li>
          <li><strong>Alt+drag</strong> a node to duplicate it at the drag destination.</li>
          <li><strong>Right-click</strong> for context menus (rename, duplicate, delete, edit part).</li>
          <li><strong>Delete</strong> removes the selection (device instances are pruned from harnesses).</li>
          <li><strong>Arrow keys</strong> nudge the selected device (hold Shift for 10px steps).</li>
        </ul>
      </Section>

      <Section title="Harness Edges">
        <P>Each harness edge shows:</P>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>The <strong>harness name</strong>.</li>
          <li>A coloured status icon: <span className="text-[#3fb27f]">green check</span> = wired, <span className="text-[#c48a2f]">amber</span> = partial, <span className="text-[#7a808c]">grey</span> = unwired, <span className="text-[#e5484d]">red</span> = invalid.</li>
          <li><strong>Wire count</strong> (e.g. "5w").</li>
        </ul>
      </Section>
    </div>
  )
}

function HarnessSection() {
  return (
    <div className="space-y-4">
      <Section title="Harness Editor">
        <P>
          The Harness Editor is a full-screen overlay with its own React Flow canvas. It
          shows a pin-column node for each endpoint — derived from the device port's
          pinout template and connector.
        </P>
      </Section>

      <Section title="Wiring Pins">
        <P>
          Each pin is a coloured position badge. Drag from one pin handle to another to
          create a wire. A pin can carry at most one wire. Signal classes are colour-coded:
        </P>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><span className="text-[#e5484d]">Power</span> — red</li>
          <li><span className="text-[#84878c]">Ground</span> — grey</li>
          <li><span className="text-[#5b9bff]">Data</span> — blue</li>
          <li><span className="text-[#c48a2f]">Shield</span> — amber</li>
          <li><span className="text-muted">NC</span> — dark (not connected)</li>
        </ul>
      </Section>

      <Section title="Auto-Wire">
        <P>
          Click <strong>Auto-wire</strong> to automatically connect pins between adjacent
          endpoint columns that share the same signal name. Pins already wired, NC pins, and
          pins with no signal name are skipped.
        </P>
      </Section>

      <Section title="Wire Properties">
        <P>Click a wire edge to select it. A popup lets you:</P>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><strong>Assign a wire part</strong> from the sidebar library. Multi-conductor cables fan out into individual strands (plus a shield wire if applicable).</li>
          <li><strong>Set a custom colour</strong> with a colour picker.</li>
          <li><strong>Add a label</strong> for reports (otherwise auto-numbered W1, W2, …).</li>
          <li><strong>Select two wires</strong> on the same endpoint pair and click <strong>Form twisted pair</strong> to twist them together. Twisted pairs render as sine-wave helices.</li>
        </ul>
      </Section>

      <Section title="Segment Lengths">
        <P>
          In the toolbar, each endpoint pair shows a length chip. Click to edit — enter the
          cut length in millimetres. These lengths drive the cutlist with optional slack.
        </P>
      </Section>

      <Section title="Collapse Unused Pins">
        <P>
          Toggle <strong>Hide unused pins</strong> to collapse pins that have no wire
          connected, cleaning up the view on dense connectors.
        </P>
      </Section>
    </div>
  )
}

function LibrarySection() {
  return (
    <div className="space-y-4">
      <Section title="Library">
        <P>
          The Library (left sidebar) holds all reusable parts and pinout templates. It is
          global — shared across all projects. Changes auto-save to disk.
        </P>
      </Section>

      <Section title="Part Editor">
        <P>
          Click <strong>+</strong> next to a category or right-click a card → Edit to open
          the Part Editor. All part kinds share common fields:
        </P>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li>Name, type (COTS/MOTS/Custom), internal part number</li>
          <li>Manufacturer and supplier with hyperlinked part numbers</li>
          <li>Cost (any currency) and weight</li>
          <li>Image upload (thumbnails auto-generated)</li>
        </ul>
        <P className="mt-2"><strong>Kind-specific fields:</strong></P>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><strong>Device</strong> — add/remove ports, assign side and pinout template.</li>
          <li><strong>Connector</strong> — number of positions, gender, optional mating connector reference.</li>
          <li><strong>Wire</strong> — gauge, colour, number of conductors, shield, cable style, colour code standard.</li>
        </ul>
      </Section>

      <Section title="Pinout Template Editor">
        <P>
          Pick a connector part first. A pin grid appears, sized to the connector's
          positions. Type signal names and pick signal classes. These templates are assigned
          to device ports.
        </P>
      </Section>

      <Section title="Library Manager">
        <P>
          Press <Kbd>Ctrl+L</Kbd> for the full Library Manager — search, filter by kind,
          connector pin count, or gender. Bulk select and delete parts. Import/export{' '}
          <strong>.wwlib</strong> files to share parts between machines.
        </P>
      </Section>

      <Section title="In-Use Protection">
        <P>
          You cannot delete a part that is referenced by a device port, a pinout template,
          or a harness wire. The error message tells you exactly what references it.
        </P>
      </Section>

      <Tip>
        Starter library content is seeded on first run, and content packs (Deutsch DT,
        Molex Micro-Fit, D-Sub, 8P8C, ECU/PDM) are available in the{' '}
        <code>data/</code> directory. Import them via Library Manager.
      </Tip>
    </div>
  )
}

function ManufacturingSection() {
  return (
    <div className="space-y-4">
      <Section title="Manufacturing Documentation">
        <P>
          Press <strong>Reports</strong> (<Kbd>Ctrl+R</Kbd>) or <strong>BOM</strong> (<Kbd>Ctrl+B</Kbd>)
          in the title bar to generate production documentation from your design.
        </P>
      </Section>

      <Section title="Reports Modal">
        <P>The Reports panel has three tabs:</P>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Wiring Table</strong> — from–to list per wire: device, port, pin,
            signal, colour, gauge, wire part, and length. Export as CSV.
          </li>
          <li>
            <strong>Cutlist</strong> — aggregated by wire part × gauge × colour × cut
            length. Set a <em>slack allowance</em> (mm) for termination/service loops.
            Export as CSV.
          </li>
          <li>
            <strong>Netlist</strong> — system-level electrical nets: pins joined by any
            harness wire form one net. Net names are derived from the most common signal
            name. Export as CSV.
          </li>
        </ul>
      </Section>

      <Section title="BOM Export">
        <P>
          The <strong>BOM CSV</strong> (<Kbd>Ctrl+B</Kbd>) includes devices, derived
          connectors (two per harness endpoint), assigned wire parts, and any harness
          accessories. Quantities, unit cost, extended cost, and weight are rolled up with
          totals per currency.
        </P>
      </Section>

      <Section title="HTML & PDF Report">
        <P>
          From the Reports modal, export a <strong>self-contained HTML report</strong>
          (shareable without WireWeaver) or a <strong>PDF</strong>. The report includes:
        </P>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li>Title block (revision, author, date, description)</li>
          <li>Assembly diagram (embedded PNG)</li>
          <li>Bill of Materials</li>
          <li>Per-harness wiring tables with notes</li>
          <li>Cutlist and Netlist</li>
        </ul>
      </Section>

      <Section title="WireViz Export">
        <P>
          Export any harness as <strong>WireViz YAML</strong> — compatible with the
          open-source WireViz tool for further diagram generation. Available from the
          Reports modal.
        </P>
      </Section>

      <Section title="Bundle Labels">
        <P>
          The cutlist CSV includes bundle labels for label printers (Brady/Dymo
          compatible). Each segment gets a unique label based on its endpoint pair.
        </P>
      </Section>
    </div>
  )
}

function DrcSection() {
  return (
    <div className="space-y-4">
      <Section title="Design Rule Check">
        <P>
          The <strong>DRC</strong> button in the header runs a suite of checks across your
          entire project. A live badge shows the count — red for errors, amber for
          warnings. Click to open the DRC panel with jump-to-issue links.
        </P>
      </Section>

      <Section title="Checks Run">
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Missing parts/templates</strong> — device instances referencing deleted or unresolved library parts.</li>
          <li><strong>Port in multiple harnesses</strong> — a device port belongs to more than one harness.</li>
          <li><strong>Unresolved endpoints</strong> — harness endpoints that cannot resolve a connector/pinout from the device port.</li>
          <li><strong>Orphan wires</strong> — wires that reference pins no longer present (template changed).</li>
          <li><strong>Signal-class mismatches</strong> — e.g. a power pin wired to a data pin.</li>
          <li><strong>Missing wire parts</strong> — wires without an assigned physical wire part.</li>
          <li><strong>Non-mutual twisted pairs</strong> — a wire references a twist partner that doesn't reference it back.</li>
          <li><strong>Missing segment lengths</strong> — a wired endpoint pair has no length set; the cutlist will be incomplete.</li>
          <li><strong>Unterminated pins</strong> — non-NC pins on a harness endpoint that have no wire connected.</li>
          <li><strong>Placeholder parts</strong> — generic/unspecified parts in use that should be replaced.</li>
          <li><strong>Current rating exceeded</strong> — a pin's current rating exceeds the connector's rating.</li>
          <li><strong>Shield not grounded</strong> — a shield wire is not connected to a ground pin.</li>
          <li><strong>Splice validation</strong> — splices with fewer than 2 wires, or wires in multiple splices.</li>
        </ul>
      </Section>

      <Tip>
        Errors are blocking — they mean the design is inconsistent and manufacturing docs
        may be incorrect. Warnings are advisory. Use the jump links in the DRC panel to
        navigate directly to the affected device or harness.
      </Tip>
    </div>
  )
}

function ShortcutsSection() {
  return (
    <div className="space-y-4">
      <Section title="Keyboard Shortcuts">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-edge px-2 py-1.5 text-left text-[11px] font-semibold text-muted uppercase">Shortcut</th>
              <th className="border-b border-edge px-2 py-1.5 text-left text-[11px] font-semibold text-muted uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {[
              ['Ctrl+S', 'Save project'],
              ['Ctrl+Shift+S', 'Save As'],
              ['Ctrl+O', 'Open project'],
              ['Ctrl+N', 'New project'],
              ['Ctrl+B', 'Export BOM (CSV)'],
              ['Ctrl+R', 'Reports & exports'],
              ['Ctrl+E', 'Edit selected harness'],
              ['Ctrl+H', 'Toggle library sidebar'],
              ['Ctrl+Z', 'Undo'],
              ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
              ['Ctrl+F', 'Focus library search'],
              ['Ctrl+D', 'Duplicate selected device/harness'],
              ['Ctrl+L', 'Library Manager'],
              ['F2', 'Rename selected'],
              ['Delete / Backspace', 'Delete selected'],
              ['Ctrl+click', 'Multi-select device on canvas'],
              ['Alt+drag', 'Duplicate device while dragging'],
              ['Arrow keys', 'Nudge selected device (1px)'],
              ['Shift+Arrow', 'Nudge 10px'],
              ['Escape', 'Close overlay / deselect'],
              ['?', 'Keyboard shortcuts cheatsheet'],
              ['F1', 'This documentation']
            ].map(([key, desc], i) => (
              <tr key={i} className="border-b border-edge/20">
                <td className="px-2 py-1"><Kbd>{key}</Kbd></td>
                <td className="px-2 py-1">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}
