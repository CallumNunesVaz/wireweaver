import { useMemo, useState } from 'react'
import { Pencil, Trash2, Copy, Cable, Cpu, AlertTriangle, Plus, X, Boxes } from 'lucide-react'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness } from '../model/derivation'
import { formatMoney } from '../model/currency'
import { isConnector, isWire, type AccessoryCategory } from '../model/types'
import { createSubassembly } from '../model/subassembly'
import { promptDialog } from '../shared/dialogs'
import { toast } from '../shared/toast'

const ACCESSORY_CATEGORIES: { value: AccessoryCategory; label: string }[] = [
  { value: 'contact', label: 'Contact' },
  { value: 'backshell', label: 'Backshell' },
  { value: 'seal', label: 'Seal' },
  { value: 'heatshrink', label: 'Heat Shrink' },
  { value: 'loom', label: 'Loom' },
  { value: 'label', label: 'Label' },
  { value: 'other', label: 'Other' }
]

export function Inspector() {
  const selection = useUiStore((s) => s.selection)
  if (!selection) return null
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-edge bg-panel">
      {selection.type === 'instance' ? (
        <InstanceInspector id={selection.id} />
      ) : (
        <HarnessInspector id={selection.id} />
      )}
    </aside>
  )
}

function Header({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
      {icon}
      {title}
    </div>
  )
}

function InstanceInspector({ id }: { id: string }) {
  const instance = useProjectStore((s) =>
    s.project.deviceInstances.find((d) => d.id === id)
  )
  const setLabel = useProjectStore((s) => s.setInstanceLabel)
  const removeInstance = useProjectStore((s) => s.removeInstance)
  const duplicateInstance = useProjectStore((s) => s.duplicateInstance)
  const part = useLibraryStore((s) =>
    instance ? s.parts.find((p) => p.id === instance.partId) : undefined
  )
  const openPartEditor = useUiStore((s) => s.openPartEditor)
  const select = useUiStore((s) => s.select)

  if (!instance) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header icon={<Cpu size={14} />} title="Device" />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div>
          <label className="ww-label">Instance label</label>
          <input
            className="ww-input"
            value={instance.label}
            onChange={(e) => setLabel(id, e.target.value)}
          />
        </div>
        <Row k="Part" v={part?.name ?? 'missing'} />
        <Row k="Type" v={part?.type ?? '—'} />
        <Row k="Internal PN" v={part?.internalPartNumber || '—'} />
        <Row k="Cost" v={formatMoney(part?.cost)} />
        <Row
          k="Weight"
          v={part?.weightGrams != null ? `${part.weightGrams} g` : '—'}
        />
        {part && part.kind === 'device' && (
          <div>
            <label className="ww-label">Ports</label>
            <div className="space-y-1">
              {part.ports.map((p) => (
                <div key={p.id} className="ww-chip w-full justify-start">
                  {p.name} · {p.side}
                </div>
              ))}
              {part.ports.length === 0 && (
                <div className="text-[11px] text-muted">No ports defined.</div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-1 border-t border-edge p-2">
        {part && (
          <button
            className="ww-btn flex-1"
            onClick={() => openPartEditor({ kind: part.kind, partId: part.id })}
          >
            <Pencil size={13} /> Edit part
          </button>
        )}
        <button className="ww-btn" onClick={() => duplicateInstance(id)} title="Duplicate">
          <Copy size={14} />
        </button>
        <button
          className="ww-btn"
          onClick={() => {
            removeInstance(id)
            select(null)
          }}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function HarnessInspector({ id }: { id: string }) {
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === id))
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const updateHarness = useProjectStore((s) => s.updateHarness)
  const removeHarness = useProjectStore((s) => s.removeHarness)
  const addAccessory = useProjectStore((s) => s.addHarnessAccessory)
  const removeAccessory = useProjectStore((s) => s.removeHarnessAccessory)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const select = useUiStore((s) => s.select)

  const [showAccessoryModal, setShowAccessoryModal] = useState(false)
  const [accCategory, setAccCategory] = useState<AccessoryCategory>('contact')
  const [accPartId, setAccPartId] = useState('')
  const [accQty, setAccQty] = useState(1)
  const [accSearch, setAccSearch] = useState('')

  const lib = useMemo(
    () => selectLibraryLike({ parts, templates }),
    [parts, templates]
  )

  const info = useMemo(() => {
    if (!harness) return null
    const eps = harness.endpoints.map((ep) => resolveEndpoint(lib, instances, ep))
    const v = validateHarness(lib, instances, harness)
    return { eps, v }
  }, [harness, lib, instances])

  const connectorWireParts = useMemo(
    () => parts.filter((p) => isConnector(p) || isWire(p)),
    [parts]
  )
  const filteredPartOptions = useMemo(
    () => connectorWireParts.filter((p) =>
      !accSearch.trim() || p.name.toLowerCase().includes(accSearch.trim().toLowerCase()) ||
      p.internalPartNumber.toLowerCase().includes(accSearch.trim().toLowerCase())
    ),
    [connectorWireParts, accSearch]
  )

  if (!harness || !info) return null
  const { eps, v } = info

  const accessories = harness.accessories ?? []
  const accessoryCount = accessories.reduce((sum, a) => sum + a.quantity, 0)

  const handleAddAccessory = () => {
    if (!accPartId) return
    addAccessory(id, { category: accCategory, partId: accPartId, quantity: accQty })
    setShowAccessoryModal(false)
    setAccPartId('')
    setAccQty(1)
    setAccSearch('')
  }

  const saveAsSubassembly = async () => {
    const name = await promptDialog({
      title: 'Save as subassembly',
      label: 'Subassembly name',
      defaultValue: harness.name,
      confirmLabel: 'Save to library'
    })
    if (!name || !name.trim()) return
    const sub = createSubassembly(harness, name.trim(), {
      name: name.trim(),
      type: 'Custom',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      notes: harness.description
    })
    upsertPart(sub)
    toast(`Saved subassembly "${sub.name}" to the library.`, 'success')
  }

  const lookupPart = (partId: string) => parts.find((p) => p.id === partId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header icon={<Cable size={14} />} title="Harness" />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div>
          <label className="ww-label">Name</label>
          <input
            className="ww-input"
            value={harness.name}
            onChange={(e) => updateHarness(id, { name: e.target.value })}
          />
        </div>

        <div>
          <label className="ww-label">Endpoints</label>
          <div className="space-y-1.5">
            {eps.map((re, i) => (
              <EndpointCard
                key={i}
                label={`End ${String.fromCharCode(65 + i)}`}
                title={re ? `${re.instance.label} · ${re.port.name}` : 'unresolved'}
                connector={re?.connector?.name}
                matingConnector={re?.matingConnector?.name}
              />
            ))}
          </div>
        </div>

        {harness.segments.length > 0 && (
          <div>
            <label className="ww-label">Segments</label>
            {harness.segments.map((seg, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted">
                  {seg.fromEnd.toUpperCase()} → {seg.toEnd.toUpperCase()}
                </span>
                <span>
                  {seg.lengthMm != null ? `${seg.lengthMm} mm` : '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between rounded border border-edge bg-panelalt px-2 py-1.5 text-xs">
          <span className="text-muted">Status</span>
          <span className="font-medium capitalize">{v.status}</span>
        </div>
        <Row k="Wires" v={`${v.wireCount} / ${v.maxPins}`} />
        {accessoryCount > 0 && (
          <Row k="Accessories" v={`${accessories.length} kinds · ${accessoryCount} total`} />
        )}

        {/* Accessories section */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="ww-label mb-0">Accessories</label>
            <button
              className="ww-btn"
              onClick={() => setShowAccessoryModal(true)}
              title="Add accessory"
            >
              <Plus size={12} /> Add
            </button>
          </div>
          {accessories.length === 0 ? (
            <div className="text-[11px] text-muted">No accessories added.</div>
          ) : (
            <div className="space-y-1">
              {accessories.map((acc) => {
                const part = lookupPart(acc.partId)
                return (
                  <div key={acc.id} className="flex items-center justify-between rounded border border-edge bg-panelalt px-2 py-1 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{part?.name ?? 'unknown part'}</div>
                      <div className="text-[10px] text-muted capitalize">{acc.category} · Qty {acc.quantity}</div>
                    </div>
                    <button
                      className="ml-1 text-muted hover:text-[#e5484d]"
                      onClick={() => removeAccessory(id, acc.id)}
                      title="Remove accessory"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {v.warnings.length > 0 && (
          <div className="space-y-1">
            {v.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 rounded border border-[#c48a2f]/40 bg-[#c48a2f]/10 px-2 py-1 text-[11px] text-[#e0b25c]"
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1 border-t border-edge p-2">
        <button className="ww-btn-primary flex-1" onClick={() => openHarnessEditor(id)}>
          <Pencil size={13} /> Wire harness
        </button>
        <button
          className="ww-btn"
          onClick={saveAsSubassembly}
          title="Save as reusable subassembly"
        >
          <Boxes size={14} />
        </button>
        <button
          className="ww-btn"
          onClick={() => {
            removeHarness(id)
            select(null)
          }}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Add Accessory Modal */}
      {showAccessoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={() => setShowAccessoryModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-edge bg-panel shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <span className="text-sm font-semibold">Add Accessory</span>
              <button className="text-muted hover:text-ink" onClick={() => setShowAccessoryModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="ww-label">Category</label>
                <select
                  className="ww-input"
                  value={accCategory}
                  onChange={(e) => setAccCategory(e.target.value as AccessoryCategory)}
                >
                  {ACCESSORY_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ww-label">Part</label>
                <input
                  className="ww-input mb-1"
                  placeholder="Search parts…"
                  value={accSearch}
                  onChange={(e) => setAccSearch(e.target.value)}
                />
                <div className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-edge">
                  {filteredPartOptions.slice(0, 20).map((p) => (
                    <button
                      key={p.id}
                      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-panelalt ${
                        accPartId === p.id ? 'bg-accent/20 text-accent' : ''
                      }`}
                      onClick={() => setAccPartId(p.id)}
                    >
                      <span className="truncate flex-1">{p.name}</span>
                      <span className="text-[10px] text-muted capitalize">{p.kind}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="ww-label">Quantity</label>
                <input
                  type="number"
                  min={1}
                  className="ww-input"
                  value={accQty}
                  onChange={(e) => setAccQty(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
              <button className="ww-btn" onClick={() => setShowAccessoryModal(false)}>
                Cancel
              </button>
              <button
                className="ww-btn-primary"
                onClick={handleAddAccessory}
                disabled={!accPartId}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EndpointCard({
  label,
  title,
  connector,
  matingConnector
}: {
  label: string
  title: string
  connector?: string
  matingConnector?: string
}) {
  return (
    <div className="rounded border border-edge bg-panelalt px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-xs font-medium">{title}</div>
      <div className="truncate text-[11px] text-muted">
        {connector ? `Connector: ${connector}` : 'No connector (template incomplete)'}
        {matingConnector && connector && (
          <span className="ml-1">← {matingConnector}</span>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{k}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{v}</span>
    </div>
  )
}
