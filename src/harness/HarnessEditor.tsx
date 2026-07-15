import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  type Node,
  type Edge,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes
} from '@xyflow/react'
import {
  Zap,
  Eraser,
  X,
  AlertTriangle,
  Cable,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  GripHorizontal,
  ImageDown,
  EyeOff,
  Eye,
  Shield,
  Link2,
  Unlink2,
  Pencil
} from 'lucide-react'
import { PinColumnNode, type PinColumnData } from './PinColumnNode'
import { TwistedPairEdge } from './TwistedPairEdge'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness } from '../model/derivation'
import { isWire, endLabel, type HarnessWire, type PinDef, type WirePart } from '../model/types'
import { codeSequence, codeColor, formatGauge } from '../model/wire'
import { imageUrl } from '../shared/useImage'
import { toast } from '../shared/toast'

const nodeTypes: NodeTypes = { pincol: PinColumnNode }
const edgeTypes = { twisted: TwistedPairEdge }

function parseHandle(h: string | null | undefined): { end: string; position: number } | null {
  if (!h) return null
  const clean = h.endsWith('-tgt') ? h.slice(0, -4) : h
  const parts = clean.split(':')
  if (parts.length !== 2) return null
  return { end: parts[0], position: Number(parts[1]) }
}

const COLUMN_SPACING = 420
const ROW_SPACING = 340

export function HarnessEditor({ harnessId }: { harnessId: string }) {
  const close = useUiStore((s) => s.closeHarnessEditor)
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === harnessId))
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const setWires = useProjectStore((s) => s.setHarnessWires)
  const updateHarness = useProjectStore((s) => s.updateHarness)
  const setSegment = useProjectStore((s) => s.setHarnessSegment)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)

  const [selectedWireIds, setSelectedWireIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [wireSearch, setWireSearch] = useState('')
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null)
  const [hideUnused, setHideUnused] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  // Esc dismisses the innermost layer first: wire popup, then the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (popupPos) {
        setSelectedWireIds([])
        setPopupPos(null)
        return
      }
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, popupPos])

  const lib = useMemo(
    () => selectLibraryLike({ parts, templates }),
    [parts, templates]
  )

  const q = wireSearch.trim().toLowerCase()
  const wireParts = useMemo(
    () => parts.filter(isWire).filter((w) => !q || w.name.toLowerCase().includes(q)),
    [parts, q]
  )

  const endpoints = harness?.endpoints ?? []
  const numEndpoints = endpoints.length

  // Resolve all endpoints
  const resolvedEndpoints = useMemo(
    () => endpoints.map((ep) => resolveEndpoint(lib, instances, ep)),
    [lib, instances, endpoints]
  )

  const validation = useMemo(
    () => (harness ? validateHarness(lib, instances, harness) : null),
    [harness, lib, instances]
  )

  // Segments to offer length inputs for: every endpoint pair that is actually
  // wired (star wiring makes non-adjacent pairs like a–c normal), plus pairs
  // that already have a segment, plus adjacent pairs as a starting default.
  const segmentPairs = useMemo(() => {
    const pairs = new Set<string>()
    for (let i = 0; i < numEndpoints - 1; i++) {
      pairs.add(`${endLabel(i)}~${endLabel(i + 1)}`)
    }
    for (const w of harness?.wires ?? []) {
      if (w.from.end !== w.to.end) pairs.add([w.from.end, w.to.end].sort().join('~'))
    }
    for (const s of harness?.segments ?? []) {
      pairs.add([s.fromEnd, s.toEnd].sort().join('~'))
    }
    return [...pairs].sort().map((k) => k.split('~') as [string, string])
  }, [harness?.wires, harness?.segments, numEndpoints])

  const wiredPositions = useMemo(() => {
    const all: Record<string, Set<number>> = {}
    for (let i = 0; i < numEndpoints; i++) {
      all[endLabel(i)] = new Set<number>()
    }
    for (const w of harness?.wires ?? []) {
      all[w.from.end]?.add(w.from.position)
      all[w.to.end]?.add(w.to.position)
    }
    return all
  }, [harness?.wires, numEndpoints])

  const pinColors = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const w of harness?.wires ?? []) {
      if (w.color) {
        map[`${w.from.end}:${w.from.position}`] = w.color
        map[`${w.to.end}:${w.to.position}`] = w.color
      }
    }
    return map
  }, [harness?.wires])

  // All wires — no filtering by endpoint pair
  const allWires = harness?.wires ?? []

  // Build a node for each endpoint. Default placement is a grid (so wires
  // between non-adjacent endpoints don't all overlap on one line); users can
  // drag columns and positions persist on the harness.
  const nodes: Node[] = useMemo(() => {
    if (!harness || numEndpoints === 0) return []
    const cols = Math.max(1, Math.ceil(Math.sqrt(numEndpoints)))
    return endpoints.map((_, i) => {
      const label = endLabel(i)
      const re = resolvedEndpoints[i]
      const position = harness.layout?.[label] ?? {
        x: (i % cols) * COLUMN_SPACING,
        y: Math.floor(i / cols) * ROW_SPACING
      }
      return {
        id: `end-${label}`,
        type: 'pincol',
        position,
        data: {
          end: label,
          title: re ? `${re.instance.label} · ${re.port.name}` : `End ${label.toUpperCase()}`,
          connectorName: re?.connector?.name ?? 'no connector',
          pins: re?.pins ?? [],
          wiredPositions: [...(wiredPositions[label] ?? [])],
          hideUnused,
          pinColors: (re?.pins ?? []).map((p) => pinColors[`${label}:${p.position}`])
        } satisfies PinColumnData
      }
    })
  }, [harness, numEndpoints, endpoints, resolvedEndpoints, wiredPositions, pinColors, hideUnused])

  // React Flow drives column motion locally; structure resyncs from the store.
  const [flowNodes, setFlowNodes, onNodesChangeRaw] = useNodesState<Node>([])
  useEffect(() => {
    setFlowNodes(nodes)
  }, [nodes, setFlowNodes])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRaw(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) {
          const label = c.id.replace(/^end-/, '')
          const current = useProjectStore.getState().project.harnesses.find((h) => h.id === harnessId)
          updateHarness(harnessId, {
            layout: { ...(current?.layout ?? {}), [label]: c.position }
          })
        }
      }
    },
    [onNodesChangeRaw, harnessId, updateHarness]
  )

  // Edges for ALL wires between any endpoints
  const edges: Edge[] = useMemo(() => {
    if (!harness) return []
    const sel = new Set(selectedWireIds)
    const byId = new Map(allWires.map((w) => [w.id, w]))
    return allWires.map((w) => {
      const unassigned = !w.wirePartId
      const isSelected = sel.has(w.id)
      // A mutual twisted pair renders as a helix: each strand needs its
      // mate's handle ids to compute the shared centerline.
      const mate = w.twistedWith ? byId.get(w.twistedWith) : undefined
      const isTwisted = !!mate && mate.twistedWith === w.id
      let twistData: Record<string, unknown> | undefined
      if (isTwisted && mate) {
        const aligned = mate.from.end === w.from.end
        const mFrom = aligned ? mate.from : mate.to
        const mTo = aligned ? mate.to : mate.from
        twistData = {
          mateSourceHandle: `${mFrom.end}:${mFrom.position}`,
          mateTargetHandle: `${mTo.end}:${mTo.position}`,
          // Opposite phases interleave the two strands into one helix.
          phase: w.id < mate.id ? 0 : Math.PI
        }
      }
      return {
        id: w.id,
        source: `end-${w.from.end}`,
        sourceHandle: `${w.from.end}:${w.from.position}`,
        target: `end-${w.to.end}`,
        targetHandle: `${w.to.end}:${w.to.position}-tgt`,
        selected: isSelected,
        type: isTwisted ? 'twisted' : undefined,
        data: twistData,
        style: {
          stroke: w.color ?? (unassigned ? '#c48a2f' : '#5b9bff'),
          strokeWidth: isSelected ? 3 : 2,
          strokeDasharray: unassigned ? '5 3' : undefined,
          opacity: isSelected ? 1 : 0.85
        }
      }
    })
  }, [harness, allWires, selectedWireIds])

  const pinWired = useCallback(
    (end: string, position: number) =>
      (harness?.wires ?? []).some(
        (w) =>
          (w.from.end === end && w.from.position === position) ||
          (w.to.end === end && w.to.position === position)
      ),
    [harness?.wires]
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const from = parseHandle(c.sourceHandle)
      const to = parseHandle(c.targetHandle)
      if (!from || !to) return false
      if (from.end === to.end && from.position === to.position) return false
      if (pinWired(from.end, from.position)) return false
      if (pinWired(to.end, to.position)) return false
      return true
    },
    [pinWired]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!harness) return
      const from = parseHandle(c.sourceHandle)
      const rawTarget = c.targetHandle?.endsWith('-tgt')
        ? c.targetHandle.slice(0, -4)
        : c.targetHandle
      const to = parseHandle(rawTarget)
      if (!from || !to) return
      const wire: HarnessWire = { id: nanoid(), from, to }
      setWires(harnessId, [...harness.wires, wire])
    },
    [harness, harnessId, setWires]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!harness) return
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removed.length) {
        setWires(harnessId, harness.wires.filter((w) => !removed.includes(w.id)))
      }
    },
    [harness, harnessId, setWires]
  )

  // Auto-wire between all adjacent endpoint columns
  const autoWire = useCallback(() => {
    if (!harness || numEndpoints < 2) return
    const norm = (p: PinDef) => p.signal.trim().toLowerCase()
    const existing = new Set(
      harness.wires.flatMap((w) => [
        `${w.from.end}:${w.from.position}`,
        `${w.to.end}:${w.to.position}`
      ])
    )
    const added: HarnessWire[] = []

    // Wire between each adjacent pair of columns
    for (let i = 0; i < numEndpoints - 1; i++) {
      const labelA = endLabel(i)
      const labelB = endLabel(i + 1)
      const reA = resolvedEndpoints[i]
      const reB = resolvedEndpoints[i + 1]
      if (!reA || !reB) continue

      for (const pa of reA.pins) {
        const sa = norm(pa)
        if (!sa || pa.signalClass === 'nc') continue
        if (existing.has(`${labelA}:${pa.position}`)) continue
        const match = reB.pins.find(
          (pb) =>
            norm(pb) === sa &&
            !existing.has(`${labelB}:${pb.position}`) &&
            pb.signalClass !== 'nc'
        )
        if (match) {
          added.push({
            id: nanoid(),
            from: { end: labelA, position: pa.position },
            to: { end: labelB, position: match.position }
          })
          existing.add(`${labelA}:${pa.position}`)
          existing.add(`${labelB}:${match.position}`)
        }
      }
    }

    if (added.length) setWires(harnessId, [...harness.wires, ...added])
  }, [harness, numEndpoints, resolvedEndpoints, harnessId, setWires])

  const clearWires = useCallback(() => {
    if (!harness) return
    setWires(harnessId, [])
    setSelectedWireIds([])
    setPopupPos(null)
  }, [harness, harnessId, setWires])

  const updateSelectedWire = useCallback(
    (patch: Partial<HarnessWire>) => {
      if (!harness || selectedWireIds.length === 0) return
      const wireId = selectedWireIds[0]
      setWires(harnessId, harness.wires.map((w) => (w.id === wireId ? { ...w, ...patch } : w)))
    },
    [harness, selectedWireIds, harnessId, setWires]
  )

  const assignWirePart = useCallback(
    (wirePart: WirePart, wireId: string) => {
      if (!harness) return
      const wireIdx = harness.wires.findIndex((w) => w.id === wireId)
      if (wireIdx === -1) return
      const conductors = wirePart.conductors ?? 1
      const old = harness.wires[wireIdx]
      if (conductors <= 1) {
        setWires(harnessId, harness.wires.map((w, i) =>
          i === wireIdx ? { ...w, wirePartId: wirePart.id, color: wirePart.color ?? w.color } : w
        ))
        return
      }
      const colors: (string | undefined)[] = wirePart.colorCode
        ? codeSequence(wirePart.colorCode, conductors)
        : new Array(conductors).fill(wirePart.color ?? undefined)
      const newStrands: HarnessWire[] = []
      for (let i = 0; i < conductors; i++) {
        newStrands.push({
          id: nanoid(),
          from: { ...old.from },
          to: { ...old.to },
          wirePartId: wirePart.id,
          color: colors[i]
        })
      }
      if (wirePart.shield) {
        newStrands.push({ id: nanoid(), from: { ...old.from }, to: { ...old.to }, wirePartId: wirePart.id, color: '#84878c' })
      }
      const updated = [...harness.wires]
      updated.splice(wireIdx, 1, ...newStrands)
      setWires(harnessId, updated)
      setSelectedWireIds([])
      setPopupPos(null)
    },
    [harness, harnessId, setWires]
  )

  const toggleTwistedPair = useCallback(() => {
    if (!harness || selectedWireIds.length < 2) return
    const [id1, id2] = selectedWireIds
    const w1 = harness.wires.find((w) => w.id === id1)
    const w2 = harness.wires.find((w) => w.id === id2)
    if (!w1 || !w2) return
    if (w1.twistedWith === id2 && w2.twistedWith === id1) {
      setWires(harnessId, harness.wires.map((w) =>
        w.id === id1 || w.id === id2 ? { ...w, twistedWith: undefined } : w
      ))
    } else {
      setWires(harnessId, harness.wires.map((w) => {
        if (w.id === id1) return { ...w, twistedWith: id2 }
        if (w.id === id2) return { ...w, twistedWith: id1 }
        if (w.twistedWith === id1 || w.twistedWith === id2) return { ...w, twistedWith: undefined }
        return w
      }))
    }
    setSelectedWireIds([])
    setPopupPos(null)
  }, [harness, selectedWireIds, harnessId, setWires])

  const exportPng = useCallback(async () => {
    try {
      const { toPng } = await import('html-to-image')
      // Scope to this editor's canvas — the Assembly View's React Flow is
      // still mounted underneath the overlay and would match first.
      const el = canvasRef.current?.querySelector('.react-flow__viewport') as
        | HTMLElement
        | null
      if (!el) return
      const dataUrl = await toPng(el, { backgroundColor: '#14161b' })
      const link = document.createElement('a')
      link.download = `${harness?.name ?? 'harness'}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      toast(`PNG export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [harness?.name])

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, ed: Edge) => {
      setSelectedWireIds((prev) => {
        if (prev.includes(ed.id)) return prev
        const next = [...prev, ed.id]
        return next.slice(-2)
      })
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setPopupPos({ x: _.clientX - rect.left, y: _.clientY - rect.top })
      }
    },
    []
  )

  if (!harness) return null
  const selectedWires = selectedWireIds.map((id) => harness.wires.find((w) => w.id === id)).filter(Boolean) as HarnessWire[]
  const singleWire = selectedWires.length === 1 ? selectedWires[0] : null
  const isTwisted = !!singleWire?.twistedWith
  // Twisting only makes sense for wires that run together — same endpoint
  // pair (a twisted pair diverging to different endpoints is physically
  // meaningless, and the helix rendering needs a shared centerline).
  const pairKey = (w: HarnessWire) => [w.from.end, w.to.end].sort().join('~')
  const canTwist =
    selectedWires.length === 2 && pairKey(selectedWires[0]) === pairKey(selectedWires[1])
  const areAlreadyTwisted = selectedWires.length === 2
    && selectedWires[0].twistedWith === selectedWires[1].id
    && selectedWires[1].twistedWith === selectedWires[0].id

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-panel">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold">Harness Editor</span>
        <input
          className="ww-input ml-2 w-56"
          value={harness.name}
          onChange={(e) => updateHarness(harnessId, { name: e.target.value })}
        />
        <span className="text-[11px] text-muted">
          {numEndpoints} endpoint{numEndpoints === 1 ? '' : 's'}
        </span>

        <div className="flex items-center gap-1 ml-2">
          {/* Segment lengths — editable inline, one chip per wired pair */}
          {numEndpoints >= 2 && segmentPairs.map(([al, bl]) => {
            const seg = harness.segments.find(
              (s) => (s.fromEnd === al && s.toEnd === bl) || (s.fromEnd === bl && s.toEnd === al)
            )
            const key = `${al}-${bl}`
            return editingSegment === key ? (
              <input
                key={key}
                className="ww-input w-20"
                type="number"
                placeholder="mm"
                autoFocus
                value={seg?.lengthMm ?? ''}
                onChange={(e) => setSegment(harnessId, al, bl, {
                  lengthMm: e.target.value ? Number(e.target.value) : undefined
                })}
                onBlur={() => setEditingSegment(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.stopPropagation() // keep Escape from also closing the editor
                    setEditingSegment(null)
                  }
                }}
              />
            ) : (
              <button
                key={key}
                className="ww-btn"
                onClick={() => setEditingSegment(key)}
                title={`Length: ${al.toUpperCase()} ↔ ${bl.toUpperCase()}`}
              >
                {seg?.lengthMm != null ? `${al}-${bl}: ${seg.lengthMm}mm` : `${al}-${bl}: set`}
                <Pencil size={10} className="ml-0.5" />
              </button>
            )
          })}
        </div>

        <button className="ww-btn" onClick={autoWire} title="Auto-wire adjacent columns">
          <Zap size={15} /> Auto-wire
        </button>
        <button className="ww-btn" onClick={clearWires} title="Clear all wires">
          <Eraser size={15} /> Clear
        </button>
        <button className="ww-btn" onClick={() => setHideUnused(!hideUnused)} title={hideUnused ? 'Show unused pins' : 'Hide unused pins'}>
          {hideUnused ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button className="ww-btn" onClick={exportPng} title="Export as PNG">
          <ImageDown size={15} />
        </button>

        {validation && validation.warnings.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[#e0b25c]">
            <AlertTriangle size={13} /> {validation.warnings.length}
          </span>
        )}

        <button className="ww-btn ml-auto" onClick={() => setSidebarOpen((o) => !o)} title={sidebarOpen ? 'Hide wire library' : 'Show wire library'}>
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <button className="ww-btn-primary" onClick={close}>
          <X size={15} /> Done
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-panel">
            <div className="border-b border-edge p-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input className="ww-input pl-7" placeholder="Filter wires…" value={wireSearch} onChange={(e) => setWireSearch(e.target.value)} />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
              <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wide text-muted">
                <Cable size={12} /> Wire Parts <span className="ml-auto">({wireParts.length})</span>
              </div>
              {wireParts.map((wp) => (
                <WirePartCard key={wp.id} part={wp}
                  gaugeDisplay={wp.gauge ? formatGauge(wp.gauge) : undefined}
                  colors={wp.colorCode ? codeSequence(wp.colorCode, Math.min(wp.conductors ?? 1, 8)) : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/ww-harness-wire', wp.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => { if (singleWire) assignWirePart(wp, singleWire.id) }}
                />
              ))}
            </div>
            <div className="border-t border-edge p-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted px-1">Harness Info</div>
              <textarea className="ww-input h-14 resize-none text-[11px]" placeholder="Description…" value={harness.description ?? ''} onChange={(e) => updateHarness(harnessId, { description: e.target.value })} />
              <textarea className="ww-input h-14 resize-none text-[11px]" placeholder="Notes…" value={harness.notes ?? ''} onChange={(e) => updateHarness(harnessId, { notes: e.target.value })} />
            </div>
            <div className="border-t border-edge px-2 py-1.5 text-[10px] text-muted">Drag onto a connection · Click to assign</div>
          </aside>
        )}

        <div className="relative min-w-0 flex-1" ref={canvasRef}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/ww-harness-wire')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(e) => {
            const wpId = e.dataTransfer.getData('application/ww-harness-wire')
            if (!wpId) return
            e.preventDefault()
            const wp = parts.find((p) => isWire(p) && p.id === wpId) as WirePart | undefined
            if (wp && selectedWireIds.length === 1) assignWirePart(wp, selectedWireIds[0])
          }}
        >
          <ReactFlowProvider>
            <ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onConnect={onConnect} onEdgesChange={onEdgesChange}
              isValidConnection={isValidConnection}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => { setSelectedWireIds([]); setPopupPos(null) }}
              connectionLineStyle={{ stroke: '#5b9bff', strokeWidth: 2, strokeDasharray: '5 4', opacity: 0.8 }}
              connectionRadius={50} fitView fitViewOptions={{ padding: 0.3 }}
              deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a2f3a" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>

          {selectedWires.length > 0 && popupPos && (
            <WireEditPopup selectedWires={selectedWires} wireParts={parts.filter(isWire)}
              pos={popupPos} canTwist={canTwist} areAlreadyTwisted={areAlreadyTwisted}
              isTwisted={isTwisted}
              onClose={() => { setSelectedWireIds([]); setPopupPos(null) }}
              onUpdate={(patch) => { if (singleWire) updateSelectedWire(patch) }}
              onAssign={(wp) => { if (singleWire) assignWirePart(wp as WirePart, singleWire.id) }}
              onToggleTwist={toggleTwistedPair}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function WirePartCard({ part, gaugeDisplay, colors, onDragStart, onClick }: {
  part: WirePart
  gaugeDisplay?: string
  colors?: string[]
  onDragStart: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const img = imageUrl(part.imageHash, 'thumb')
  const conductors = part.conductors ?? 1
  return (
    <div className="group flex cursor-grab items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 hover:border-accent active:cursor-grabbing"
      draggable onDragStart={onDragStart} onClick={onClick}
      title={`${part.name}${part.shield ? ' · shielded' : ''}${part.category === 'bundle' ? ' · bundle' : ''}`}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
        {img ? <img src={img} className="h-full w-full object-cover" alt="" /> : part.shield ? <Shield size={12} className="text-muted" /> : <Cable size={12} className="text-muted" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{part.name}</div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
          {gaugeDisplay && <span>{gaugeDisplay}</span>}
          {conductors > 1 && <span className="rounded bg-accent/20 px-1 text-accent">{conductors}×</span>}
          {part.shield && <Shield size={10} className="text-[#c48a2f]" />}
          {part.category === 'bundle' && <span className="rounded bg-[#c48a2f]/20 px-1 text-[#c48a2f]">bundle</span>}
          {colors && colors.length > 0 && (
            <span className="flex items-center gap-0.5 ml-0.5">
              {colors.slice(0, 4).map((c, i) => <span key={i} className="inline-block h-2 w-2 rounded-full border border-white/20" style={{ background: codeColor(c) }} />)}
              {colors.length > 4 && <span className="text-[8px]">+</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function WireEditPopup({ selectedWires, wireParts, pos, canTwist, areAlreadyTwisted, isTwisted, onClose, onUpdate, onAssign, onToggleTwist }: {
  selectedWires: HarnessWire[]
  wireParts: WirePart[]
  pos: { x: number; y: number }
  canTwist: boolean; areAlreadyTwisted: boolean; isTwisted: boolean
  onClose: () => void; onUpdate: (p: Partial<HarnessWire>) => void
  onAssign: (wp: WirePart) => void; onToggleTwist: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Clicking another wire ADDS it to the selection (twisted pairs need two
      // wires selected) — closing here would wipe the selection before the
      // edge's own click handler runs.
      if (target.closest?.('.react-flow__edge')) return
      const el = document.getElementById('ww-wire-popup')
      if (el && !el.contains(target)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 100)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])
  const x = Math.max(8, Math.min(pos.x - 120, window.innerWidth - 300))
  const y = Math.max(pos.y - 20, 0)

  if (selectedWires.length === 2) {
    const [w1, w2] = selectedWires
    return (
      <div id="ww-wire-popup" className="absolute z-20 min-w-[260px] rounded-lg border border-edge bg-panel shadow-2xl p-3" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold">Twisted Pair</span>
          <button className="text-muted hover:text-ink" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="space-y-2 mb-3">
          <div className="text-[11px] text-muted">
            <span className="font-medium">{w1.from.end.toUpperCase()}{w1.from.position} → {w1.to.end.toUpperCase()}{w1.to.position}</span>
            {' + '}
            <span className="font-medium">{w2.from.end.toUpperCase()}{w2.from.position} → {w2.to.end.toUpperCase()}{w2.to.position}</span>
          </div>
          {!canTwist && <div className="flex items-center gap-1.5 text-[11px] text-[#c48a2f]"><AlertTriangle size={12} className="shrink-0" />Can't pair these wires</div>}
          {canTwist && areAlreadyTwisted && <div className="text-[11px] text-muted">Already twisted together.</div>}
        </div>
        {canTwist && (
          <button className={`ww-btn w-full ${areAlreadyTwisted ? 'text-[#e5484d]' : 'text-accent'}`} onClick={onToggleTwist}>
            {areAlreadyTwisted ? <><Unlink2 size={14} /> Untwist pair</> : <><Link2 size={14} /> Form twisted pair</>}
          </button>
        )}
      </div>
    )
  }

  const wire = selectedWires[0]
  const assignedPart = wireParts.find((p) => p.id === wire.wirePartId)
  return (
    <div id="ww-wire-popup" className="absolute z-20 min-w-[260px] rounded-lg border border-edge bg-panel shadow-2xl p-3" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">Wire {wire.from.end.toUpperCase()}{wire.from.position} → {wire.to.end.toUpperCase()}{wire.to.position}</span>
        <button className="text-muted hover:text-ink" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="ww-label">Wire part</label>
          {assignedPart ? (
            <div className="flex items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 text-xs">
              <Cable size={12} className="text-accent" />
              <span className="flex-1 truncate">{assignedPart.name}</span>
              <button className="text-[10px] text-muted hover:text-ink" onClick={() => onUpdate({ wirePartId: undefined })}>Clear</button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-[#c48a2f]"><AlertTriangle size={12} className="shrink-0" />No wire part assigned</div>
          )}
        </div>
        <div className="relative">
          <button className="ww-btn w-full justify-between" onClick={() => setOpen(!open)}>
            <span className="truncate">{open ? 'Pick a wire…' : 'Assign / change wire…'}</span>
            <GripHorizontal size={12} className="text-muted shrink-0" />
          </button>
          {open && (
            <div className="absolute left-0 bottom-full z-30 mb-1 max-h-48 w-full overflow-y-auto rounded border border-edge bg-panel shadow-xl">
              {wireParts.map((wp) => (
                <button key={wp.id} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-panelalt"
                  onClick={() => { onAssign(wp); setOpen(false) }}>
                  <span className="truncate flex-1">{wp.name}</span>
                  {(wp.conductors ?? 1) > 1 && <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">{wp.conductors}×</span>}
                  {wp.shield && <Shield size={10} className="text-[#c48a2f]" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="ww-label">Colour</label>
          <input type="color" className="h-7 w-10 rounded border border-edge bg-panelalt cursor-pointer" value={wire.color ?? '#5b9bff'} onChange={(e) => onUpdate({ color: e.target.value })} />
        </div>
        <div>
          <label className="ww-label">Label</label>
          <input
            className="ww-input w-full"
            value={wire.label ?? ''}
            placeholder="auto (W1, W2, …)"
            onChange={(e) => onUpdate({ label: e.target.value || undefined })}
            onKeyDown={(e) => {
              // Keep Enter/Escape inside the input — the editor's own handlers
              // would close the popup or the whole overlay.
              if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
            }}
          />
        </div>
        {isTwisted && <div className="flex items-center gap-1.5 text-[10px] text-accent"><Link2 size={12} /> Twisted pair — select both wires to untwist</div>}
      </div>
    </div>
  )
}
