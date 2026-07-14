import { useMemo } from 'react'
import { Pencil, Trash2, Copy, Cable, Cpu, AlertTriangle } from 'lucide-react'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness } from '../model/derivation'
import { formatMoney } from '../model/currency'

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
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const select = useUiStore((s) => s.select)

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

  if (!harness || !info) return null
  const { eps, v } = info

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
          onClick={() => {
            removeHarness(id)
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

function EndpointCard({
  label,
  title,
  connector
}: {
  label: string
  title: string
  connector?: string
}) {
  return (
    <div className="rounded border border-edge bg-panelalt px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-xs font-medium">{title}</div>
      <div className="truncate text-[11px] text-muted">
        {connector ? `Connector: ${connector}` : 'No connector (template incomplete)'}
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
