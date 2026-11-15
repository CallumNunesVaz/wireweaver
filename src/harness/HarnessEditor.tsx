import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type NodeTypes
} from '@xyflow/react'
import { nanoid } from 'nanoid'
import { Virtuoso } from 'react-virtuoso'
import {
  Zap,
  Eraser,
  X,
  AlertTriangle,
  Cable,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ImageDown,
  EyeOff,
  Eye,
  Link2,
  Pencil,
  Trash2
} from 'lucide-react'
import { PinColumnNode, type PinColumnData } from './PinColumnNode'
import { TwistedPairEdge } from './TwistedPairEdge'
import { StripedWireEdge, type StripedWireData } from './StripedWireEdge'
import { SpliceNode, type SpliceNodeData } from './SpliceNode'
import { WireInspector, WirePartCard, isStripedColor, matchesWireQuery } from './WirePanels'
import { useEffectiveLibrary } from '../stores/effectiveLibrary'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness, type ResolvedEndpoint } from '../model/derivation'
import { assignWirePart, planAutoWire, planCableDeploy } from '../model/wiring'
import { endLabel, type HarnessWire, type WirePart } from '../model/types'
import { toast } from '../shared/toast'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { confirmDialog } from '../shared/dialogs'
import { useOverlay } from '../shared/overlay'
import { useRafNodeChanges } from '../shared/useRafNodeChanges'

const nodeTypes: NodeTypes = { pincol: PinColumnNode, splice: SpliceNode }
const edgeTypes = { twisted: TwistedPairEdge, striped: StripedWireEdge }

const COLUMN_SPACING = 420
const ROW_SPACING = 340
const UNASSIGNED = 'var(--color-warn)'
const DEFAULT_WIRE = 'var(--color-accent)'

/** Convert a wire colour (maybe a striped gradient) to a solid SVG stroke. */
function strokeSafe(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  if (isStripedColor(color)) return color.match(/#[0-9a-fA-F]{3,8}/)?.[0] ?? fallback
  return color
}

/** Two distinct hex colours from a striped gradient, for two-band rendering. */
function parseStripeColors(gradient: string): { primary: string; secondary: string } | null {
  const hexes = [...gradient.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0])
  const secondary = hexes.find((h) => h !== hexes[0])
  return hexes.length >= 2 && secondary ? { primary: hexes[0], secondary } : null
}

function parseHandle(h: string | null | undefined): { end: string; position: number } | null {
  if (!h) return null
  const clean = h.endsWith('-tgt') ? h.slice(0, -4) : h
  const parts = clean.split(':')
  if (parts.length !== 2) return null
  return { end: parts[0], position: Number(parts[1]) }
}

const pairKey = (w: HarnessWire) => [w.from.end, w.to.end].sort().join('~')

export function HarnessEditor({ harnessId }: { harnessId: string }) {
  const close = useUiStore((s) => s.closeHarnessEditor)
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === harnessId))
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const setWires = useProjectStore((s) => s.setHarnessWires)
  const updateHarness = useProjectStore((s) => s.updateHarness)
  const setSegment = useProjectStore((s) => s.setHarnessSegment)
  const addSplice = useProjectStore((s) => s.addSplice)
  const removeSplice = useProjectStore((s) => s.removeSplice)
  const moveSplice = useProjectStore((s) => s.moveSplice)
  const assignSpliceWire = useProjectStore((s) => s.assignSpliceWire)
  const { lib, wireParts: allWireParts } = useEffectiveLibrary()

  const z = useOverlay(close, { kind: 'workspace', allowsUndo: true })

  const [selectedWireIds, setSelectedWireIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [wireSearch, setWireSearch] = useState('')
  const [hideUnused, setHideUnused] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)
  const [wireMenu, setWireMenu] = useState<{ x: number; y: number } | null>(null)
  const [hoverSpliceId, setHoverSpliceId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  // If the harness disappears underneath us (new project, undo, revision
  // restore) close the editor rather than rendering against nothing.
  useEffect(() => {
    if (!harness) close()
  }, [harness, close])

  // Drop selections that no longer exist (after undo, delete, etc.).
  useEffect(() => {
    if (!harness) return
    setSelectedWireIds((prev) => {
      const next = prev.filter((id) => harness.wires.some((w) => w.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [harness])

  const wireParts = useMemo(() => {
    const q = wireSearch.trim()
    return q ? allWireParts.filter((w) => matchesWireQuery(w, q)) : allWireParts
  }, [allWireParts, wireSearch])

  const endpoints = useMemo(() => harness?.endpoints ?? [], [harness?.endpoints])
  const numEndpoints = endpoints.length
  const wires = useMemo(() => harness?.wires ?? [], [harness?.wires])

  const resolvedEndpoints = useMemo(
    () => endpoints.map((ep) => resolveEndpoint(lib, instances, ep)),
    [lib, instances, endpoints]
  )
  const resolvedByLabel = useMemo(() => {
    const m = new Map<string, ResolvedEndpoint>()
    resolvedEndpoints.forEach((re, i) => {
      if (re) m.set(endLabel(i), re)
    })
    return m
  }, [resolvedEndpoints])

  const validation = useMemo(
    () => (harness ? validateHarness(lib, instances, harness) : null),
    [harness, lib, instances]
  )

  // Segments to offer length inputs for: every wired endpoint pair (star
  // wiring makes non-adjacent pairs like a–c normal), pairs that already
  // have a segment, and adjacent pairs as a starting default.
  const segmentPairs = useMemo(() => {
    const pairs = new Set<string>()
    for (let i = 0; i < numEndpoints - 1; i++) pairs.add(`${endLabel(i)}~${endLabel(i + 1)}`)
    for (const w of wires) if (w.from.end !== w.to.end) pairs.add(pairKey(w))
    for (const s of harness?.segments ?? []) pairs.add([s.fromEnd, s.toEnd].sort().join('~'))
    return [...pairs].sort().map((k) => k.split('~') as [string, string])
  }, [wires, harness?.segments, numEndpoints])

  const wiredPositions = useMemo(() => {
    const all: Record<string, Set<number>> = {}
    for (let i = 0; i < numEndpoints; i++) all[endLabel(i)] = new Set<number>()
    for (const w of wires) {
      all[w.from.end]?.add(w.from.position)
      all[w.to.end]?.add(w.to.position)
    }
    return all
  }, [wires, numEndpoints])

  const pinColors = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const w of wires) {
      if (!w.color) continue
      map[`${w.from.end}:${w.from.position}`] = w.color
      map[`${w.to.end}:${w.to.position}`] = w.color
    }
    return map
  }, [wires])

  const onDropSpliceWire = useCallback(
    (spliceId: string, wp: WirePart) => assignSpliceWire(harnessId, spliceId, wp.id),
    [assignSpliceWire, harnessId]
  )

  // One node per endpoint column, plus splice markers. Default placement is a
  // grid; dragged positions persist on the harness.
  const nodes: Node[] = useMemo(() => {
    if (!harness || numEndpoints === 0) return []
    const cols = Math.max(1, Math.ceil(Math.sqrt(numEndpoints)))
    const endpointNodes: Node[] = endpoints.map((_, i) => {
      const label = endLabel(i)
      const re = resolvedEndpoints[i]
      return {
        id: `end-${label}`,
        type: 'pincol',
        position: harness.layout?.[label] ?? {
          x: (i % cols) * COLUMN_SPACING,
          y: Math.floor(i / cols) * ROW_SPACING
        },
        data: {
          end: label,
          title: re ? `${re.instance.label} · ${re.port.name}` : `End ${label.toUpperCase()}`,
          connectorName: re?.connector?.name ?? 'no connector',
          matingConnectorName: re?.matingConnector?.name,
          pins: re?.pins ?? [],
          wiredPositions: [...(wiredPositions[label] ?? [])],
          hideUnused,
          pinColors: (re?.pins ?? []).map((p) => pinColors[`${label}:${p.position}`])
        } satisfies PinColumnData
      }
    })
    const spliceNodes: Node[] = (harness.splices ?? []).map((sp, idx) => ({
      id: `splice-${sp.id}`,
      type: 'splice',
      position: sp.position ?? {
        x: (idx % cols) * COLUMN_SPACING + COLUMN_SPACING / 2,
        y: Math.floor(idx / cols) * ROW_SPACING + ROW_SPACING / 2
      },
      data: {
        spliceId: sp.id,
        name: sp.name,
        wirePartId: sp.wirePartId,
        wireCount: sp.wireIds.length,
        onDropWire: onDropSpliceWire,
        onHover: setHoverSpliceId
      } satisfies SpliceNodeData
    }))
    return [...endpointNodes, ...spliceNodes]
  }, [harness, numEndpoints, endpoints, resolvedEndpoints, wiredPositions, pinColors, hideUnused, onDropSpliceWire])

  // React Flow drives column motion locally; structure resyncs from the store.
  const [flowNodes, setFlowNodes, onNodesChangeRaw] = useNodesState<Node>([])
  useEffect(() => setFlowNodes(nodes), [nodes, setFlowNodes])

  const onNodesChange = useRafNodeChanges(onNodesChangeRaw, (moves) => {
    const current = useProjectStore.getState().project.harnesses.find((h) => h.id === harnessId)
    const layout = { ...(current?.layout ?? {}) }
    let layoutChanged = false
    for (const { id, position } of moves) {
      if (id.startsWith('splice-')) {
        moveSplice(harnessId, id.slice('splice-'.length), position)
      } else {
        layout[id.replace(/^end-/, '')] = position
        layoutChanged = true
      }
    }
    if (layoutChanged) updateHarness(harnessId, { layout })
  })

  const spliceWireIds = useMemo(() => {
    if (!hoverSpliceId) return null
    return new Set(harness?.splices?.find((s) => s.id === hoverSpliceId)?.wireIds ?? [])
  }, [hoverSpliceId, harness?.splices])

  const edges: Edge[] = useMemo(() => {
    const sel = new Set(selectedWireIds)
    const byId = new Map(wires.map((w) => [w.id, w]))
    return wires.map((w) => {
      const unassigned = !w.wirePartId
      const emphasised = sel.has(w.id) || !!spliceWireIds?.has(w.id)
      const mate = w.twistedWith ? byId.get(w.twistedWith) : undefined
      const isTwisted = !!mate && mate.twistedWith === w.id
      const stripe = isStripedColor(w.color) && w.color ? parseStripeColors(w.color) : null
      const baseColor = stripe?.primary ?? strokeSafe(w.color, unassigned ? UNASSIGNED : DEFAULT_WIRE)

      let data: Record<string, unknown> | undefined
      if (isTwisted && mate) {
        const aligned = mate.from.end === w.from.end
        const mFrom = aligned ? mate.from : mate.to
        const mTo = aligned ? mate.to : mate.from
        data = {
          mateSourceHandle: `${mFrom.end}:${mFrom.position}`,
          mateTargetHandle: `${mTo.end}:${mTo.position}`,
          // Opposite phases interleave the two strands into one helix.
          phase: w.id < mate.id ? 0 : Math.PI,
          ...(stripe ? { stripePrimary: stripe.primary, stripeSecondary: stripe.secondary } : {})
        }
      } else if (stripe) {
        data = stripe satisfies StripedWireData
      }
      const type = isTwisted ? 'twisted' : stripe ? 'striped' : undefined

      return {
        id: w.id,
        source: `end-${w.from.end}`,
        sourceHandle: `${w.from.end}:${w.from.position}`,
        target: `end-${w.to.end}`,
        targetHandle: `${w.to.end}:${w.to.position}-tgt`,
        selected: sel.has(w.id),
        type,
        data,
        ariaLabel: `Wire ${w.from.end.toUpperCase()}${w.from.position} to ${w.to.end.toUpperCase()}${w.to.position}`,
        style: {
          stroke: type === 'striped' ? undefined : baseColor,
          strokeWidth: emphasised ? 3.5 : 2,
          strokeDasharray: unassigned && type !== 'striped' ? '5 3' : undefined,
          opacity: spliceWireIds && !emphasised ? 0.35 : emphasised ? 1 : 0.85,
          filter: emphasised ? `drop-shadow(0 0 4px ${baseColor})` : undefined
        }
      }
    })
  }, [wires, selectedWireIds, spliceWireIds])

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const from = parseHandle(c.sourceHandle)
      const to = parseHandle(c.targetHandle)
      if (!from || !to) return false
      if (from.end === to.end && from.position === to.position) return false
      const latest =
        useProjectStore.getState().project.harnesses.find((h) => h.id === harnessId)?.wires ?? []
      const isWired = (end: string, position: number) =>
        latest.some(
          (w) =>
            (w.from.end === end && w.from.position === position) ||
            (w.to.end === end && w.to.position === position)
        )
      return !isWired(from.end, from.position) && !isWired(to.end, to.position)
    },
    [harnessId]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const from = parseHandle(c.sourceHandle)
      const to = parseHandle(c.targetHandle)
      if (!from || !to) return
      const wire: HarnessWire = { id: nanoid(), from, to }
      setWires(harnessId, [...wires, wire])
      setSelectedWireIds([wire.id])
    },
    [wires, harnessId, setWires]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
      if (removed.size) setWires(harnessId, wires.filter((w) => !removed.has(w.id)))
    },
    [wires, harnessId, setWires]
  )

  const autoWire = useCallback(() => {
    const added = planAutoWire(resolvedByLabel, numEndpoints, wires)
    if (added.length === 0) {
      toast('Auto-wire found no unwired pins with matching signal names.', 'info')
      return
    }
    setWires(harnessId, [...wires, ...added])
    toast(`Auto-wired ${added.length} wire${added.length === 1 ? '' : 's'}.`, 'success')
  }, [resolvedByLabel, numEndpoints, wires, harnessId, setWires])

  const clearWires = useCallback(async () => {
    if (wires.length === 0) return
    const ok = await confirmDialog({
      title: 'Clear all wires',
      message: `Remove all ${wires.length} wires from this harness?`,
      detail: 'You can undo this with Ctrl+Z.',
      confirmLabel: 'Clear',
      danger: true
    })
    if (!ok) return
    setWires(harnessId, [])
    setSelectedWireIds([])
  }, [wires, harnessId, setWires])

  const selectedWires = useMemo(
    () =>
      selectedWireIds
        .map((id) => wires.find((w) => w.id === id))
        .filter((w): w is HarnessWire => !!w),
    [selectedWireIds, wires]
  )
  const singleWire = selectedWires.length === 1 ? selectedWires[0] : null

  // Twisting only makes sense for wires on the same endpoint pair.
  const canTwist =
    selectedWires.length === 2 && pairKey(selectedWires[0]) === pairKey(selectedWires[1])
  const areTwisted =
    selectedWires.length === 2 &&
    selectedWires[0].twistedWith === selectedWires[1].id &&
    selectedWires[1].twistedWith === selectedWires[0].id

  const patchSelected = useCallback(
    (fn: (w: HarnessWire) => HarnessWire) => {
      const sel = new Set(selectedWireIds)
      setWires(
        harnessId,
        wires.map((w) => (sel.has(w.id) ? fn(w) : w))
      )
    },
    [selectedWireIds, wires, harnessId, setWires]
  )

  const applyPartToSelected = useCallback(
    (wp: WirePart) => {
      let next = wires
      for (const id of selectedWireIds) next = assignWirePart(next, id, wp)
      setWires(harnessId, next)
    },
    [wires, selectedWireIds, harnessId, setWires]
  )

  const deleteSelected = useCallback(() => {
    const sel = new Set(selectedWireIds)
    setWires(harnessId, wires.filter((w) => !sel.has(w.id)))
    setSelectedWireIds([])
  }, [selectedWireIds, wires, harnessId, setWires])

  const spliceSelected = useCallback(() => {
    if (selectedWireIds.length < 2) {
      toast('Select at least 2 wires to splice them.', 'info')
      return
    }
    addSplice(harnessId, selectedWireIds)
    setSelectedWireIds([])
  }, [selectedWireIds, addSplice, harnessId])

  const toggleTwistedPair = useCallback(() => {
    if (!canTwist) return
    const [id1, id2] = selectedWireIds
    setWires(
      harnessId,
      wires.map((w) => {
        if (areTwisted) return w.id === id1 || w.id === id2 ? { ...w, twistedWith: undefined } : w
        if (w.id === id1) return { ...w, twistedWith: id2 }
        if (w.id === id2) return { ...w, twistedWith: id1 }
        if (w.twistedWith === id1 || w.twistedWith === id2) return { ...w, twistedWith: undefined }
        return w
      })
    )
  }, [canTwist, areTwisted, selectedWireIds, wires, harnessId, setWires])

  /**
   * Lay a multi-core cable. It goes between the endpoints of the selected
   * wire when there is one, otherwise between the first two endpoints.
   */
  const deployCable = useCallback(
    (wp: WirePart) => {
      const [la, lb] = singleWire
        ? [singleWire.from.end, singleWire.to.end]
        : [endLabel(0), endLabel(1)]
      const a = resolvedByLabel.get(la)
      const b = resolvedByLabel.get(lb)
      if (!a || !b || la === lb) {
        toast('Need two resolved endpoints to lay a cable.', 'info')
        return
      }
      const strands = planCableDeploy({ label: la, endpoint: a }, { label: lb, endpoint: b }, wires, wp)
      if (strands.length === 0) {
        toast(`No free pin pairs between ${a.instance.label} and ${b.instance.label}.`, 'info')
        return
      }
      setWires(harnessId, [...wires, ...strands])
      setSelectedWireIds(strands.map((s) => s.id))
      toast(
        `Laid "${wp.name}": ${strands.length} conductor(s) between ${a.instance.label} and ${b.instance.label}.`,
        'success'
      )
    },
    [singleWire, resolvedByLabel, wires, harnessId, setWires]
  )

  /** Clicking (or dropping) a wire part: assign it, or lay it as a cable. */
  const applyWirePart = useCallback(
    (wp: WirePart) => {
      if ((wp.conductors ?? 1) > 1 && selectedWires.length !== 1) deployCable(wp)
      else if (selectedWires.length > 0) applyPartToSelected(wp)
      else toast('Select a wire first, or click a multi-core cable to lay it.', 'info')
    },
    [selectedWires.length, deployCable, applyPartToSelected]
  )

  const exportPng = useCallback(async () => {
    try {
      const { toPng } = await import('html-to-image')
      // Scope to this editor's canvas — the Assembly View is still mounted
      // underneath and would otherwise match first.
      const el = canvasRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null
      if (!el) return
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
      const dataUrl = await toPng(el, { backgroundColor: bg || '#14161b' })
      const link = document.createElement('a')
      link.download = `${harness?.name || 'harness'}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      toast(`PNG export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [harness?.name])

  const onEdgeClick = useCallback((e: React.MouseEvent, ed: Edge) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedWireIds((prev) =>
        prev.includes(ed.id) ? prev.filter((id) => id !== ed.id) : [...prev, ed.id]
      )
    } else {
      setSelectedWireIds([ed.id])
    }
  }, [])

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, ed: Edge) => {
    e.preventDefault()
    setSelectedWireIds((prev) => (prev.includes(ed.id) ? prev : [ed.id]))
    setWireMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const wireMenuItems: CtxItem[] = useMemo(() => {
    if (!wireMenu) return []
    const items: CtxItem[] = []
    if (canTwist) {
      items.push({
        label: areTwisted ? 'Untwist pair' : 'Form twisted pair',
        icon: <Link2 size={14} />,
        onClick: toggleTwistedPair
      })
    }
    if (selectedWireIds.length >= 2) {
      items.push({ label: 'Splice selected', icon: <Link2 size={14} />, onClick: spliceSelected })
    }
    items.push({
      label: selectedWireIds.length > 1 ? `Delete ${selectedWireIds.length} wires` : 'Delete wire',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: deleteSelected
    })
    return items
  }, [wireMenu, canTwist, areTwisted, toggleTwistedPair, selectedWireIds.length, spliceSelected, deleteSelected])

  // Every hook is above this line — see the Rules of Hooks.
  if (!harness) return null

  return (
    <div
      className="fixed inset-0 flex flex-col bg-panel"
      style={{ zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label={`Harness editor: ${harness.name}`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold">Harness Editor</span>
        <input
          className="ww-input w-56"
          aria-label="Harness name"
          value={harness.name}
          onChange={(e) => updateHarness(harnessId, { name: e.target.value })}
        />
        <span className="text-[11px] text-muted">
          {numEndpoints} endpoint{numEndpoints === 1 ? '' : 's'} · {wires.length} wire
          {wires.length === 1 ? '' : 's'}
        </span>

        {numEndpoints >= 2 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Segment lengths">
            {segmentPairs.map(([al, bl]) => {
              const seg = harness.segments.find(
                (s) => (s.fromEnd === al && s.toEnd === bl) || (s.fromEnd === bl && s.toEnd === al)
              )
              const key = `${al}-${bl}`
              const name = `${al.toUpperCase()}–${bl.toUpperCase()}`
              return editingSegment === key ? (
                <input
                  key={key}
                  className="ww-input w-24"
                  type="number"
                  min={0}
                  aria-label={`Length ${name} in mm`}
                  placeholder="mm"
                  autoFocus
                  value={seg?.lengthMm ?? ''}
                  onChange={(e) =>
                    setSegment(harnessId, al, bl, {
                      lengthMm: e.target.value ? Number(e.target.value) : undefined
                    })
                  }
                  onBlur={() => setEditingSegment(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.stopPropagation() // keep Escape from closing the editor
                      setEditingSegment(null)
                    }
                  }}
                />
              ) : (
                <button
                  key={key}
                  className="ww-btn"
                  onClick={() => setEditingSegment(key)}
                  title={`Set the length of segment ${name}`}
                >
                  {name}: {seg?.lengthMm != null ? `${seg.lengthMm} mm` : 'set length'}
                  <Pencil size={11} />
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <button className="ww-btn" onClick={autoWire} title="Wire pins with matching signal names">
            <Zap size={15} /> Auto-wire
          </button>
          <button className="ww-btn" onClick={() => void clearWires()} disabled={wires.length === 0}>
            <Eraser size={15} /> Clear
          </button>
          <button
            className="ww-btn"
            onClick={() => setHideUnused(!hideUnused)}
            aria-pressed={hideUnused}
            title={hideUnused ? 'Show unused pins' : 'Hide unused pins'}
            aria-label={hideUnused ? 'Show unused pins' : 'Hide unused pins'}
          >
            {hideUnused ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button className="ww-btn" onClick={exportPng} title="Export as PNG" aria-label="Export as PNG">
            <ImageDown size={15} />
          </button>
          {validation && validation.warnings.length > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] text-warn"
              title={validation.warnings.join('\n')}
            >
              <AlertTriangle size={13} /> {validation.warnings.length} warning
              {validation.warnings.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            className="ww-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? 'Hide wire library' : 'Show wire library'}
            aria-label={sidebarOpen ? 'Hide wire library' : 'Show wire library'}
          >
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          <button className="ww-btn-primary" onClick={close} title="Close the editor (Esc)">
            <X size={15} /> Done
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-60 shrink-0 flex-col border-r border-edge bg-panel" aria-label="Wire library">
            <div className="border-b border-edge p-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className="ww-input pl-7"
                  placeholder="Filter wires (e.g. 22 awg 4c)…"
                  aria-label="Filter wire parts"
                  value={wireSearch}
                  onChange={(e) => setWireSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] uppercase tracking-wide text-muted">
              <Cable size={12} /> Wire parts <span className="ml-auto">{wireParts.length}</span>
            </div>
            <div className="min-h-0 flex-1 px-2 py-1">
              {wireParts.length === 0 ? (
                <div className="px-1 py-2 text-[11px] text-muted">No wire parts match.</div>
              ) : (
                <Virtuoso
                  style={{ height: '100%' }}
                  data={wireParts}
                  computeItemKey={(_, wp) => wp.id}
                  itemContent={(_, wp) => (
                    <WirePartCard
                      part={wp}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/ww-harness-wire', wp.id)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={() => applyWirePart(wp)}
                    />
                  )}
                />
              )}
            </div>
            <div className="space-y-2 border-t border-edge p-2">
              <div className="px-1 text-[11px] uppercase tracking-wide text-muted">Harness info</div>
              <textarea
                className="ww-input h-14 resize-none text-xs"
                aria-label="Harness description"
                placeholder="Description…"
                value={harness.description ?? ''}
                onChange={(e) => updateHarness(harnessId, { description: e.target.value })}
              />
              <textarea
                className="ww-input h-14 resize-none text-xs"
                aria-label="Harness notes"
                placeholder="Notes…"
                value={harness.notes ?? ''}
                onChange={(e) => updateHarness(harnessId, { notes: e.target.value })}
              />
            </div>
            {(harness.splices ?? []).length > 0 && (
              <div className="space-y-1.5 border-t border-edge p-2">
                <div className="flex items-center gap-1.5 px-1 text-[11px] uppercase tracking-wide text-muted">
                  <Link2 size={12} /> Splices ({harness.splices!.length})
                </div>
                {harness.splices!.map((sp) => (
                  <div
                    key={sp.id}
                    className="rounded border border-edge bg-panelalt px-2 py-1 text-[11px]"
                    onMouseEnter={() => setHoverSpliceId(sp.id)}
                    onMouseLeave={() => setHoverSpliceId(null)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{sp.name}</span>
                      <button
                        className="ww-icon-btn hover:text-danger"
                        onClick={() => removeSplice(harnessId, sp.id)}
                        aria-label={`Remove ${sp.name}`}
                        title="Remove splice"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="text-muted">
                      {sp.wireIds.length} wires
                      {sp.wirePartId
                        ? ` · ${allWireParts.find((w) => w.id === sp.wirePartId)?.name ?? 'wire part'}`
                        : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-edge px-2 py-1.5 text-[11px] text-muted">
              Click a wire part to assign it · Drag onto a splice
            </div>
          </aside>
        )}

        <div
          className="relative min-w-0 flex-1"
          ref={canvasRef}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/ww-harness-wire')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            const wpId = e.dataTransfer.getData('application/ww-harness-wire')
            if (!wpId) return
            e.preventDefault()
            const wp = allWireParts.find((p) => p.id === wpId)
            if (wp) applyWirePart(wp)
          }}
        >
          <ReactFlowProvider>
            <ReactFlow
              nodes={flowNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onConnect={onConnect}
              onEdgesChange={onEdgesChange}
              isValidConnection={isValidConnection}
              onEdgeClick={onEdgeClick}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneClick={() => setSelectedWireIds([])}
              connectionLineStyle={{
                stroke: 'var(--color-accent)',
                strokeWidth: 2,
                strokeDasharray: '5 4',
                opacity: 0.8
              }}
              connectionRadius={50}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              deleteKeyCode={['Backspace', 'Delete']}
              selectNodesOnDrag={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-edge)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>

          {numEndpoints > 0 && wires.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="rounded border border-edge bg-panel px-3 py-1.5 text-xs text-muted shadow">
                Drag from one pin to another to add a wire, or use Auto-wire.
              </div>
            </div>
          )}

          {selectedWires.length > 0 && (
            <WireInspector
              wires={selectedWires}
              wireParts={allWireParts}
              canTwist={canTwist}
              areTwisted={areTwisted}
              onClose={() => setSelectedWireIds([])}
              onUpdateOne={(patch) => patchSelected((w) => ({ ...w, ...patch }))}
              onApplyPart={applyPartToSelected}
              onApplyColor={(color) => patchSelected((w) => ({ ...w, color }))}
              onToggleTwist={toggleTwistedPair}
              onSplice={spliceSelected}
              onDelete={deleteSelected}
            />
          )}

          {wireMenu && (
            <ContextMenu
              x={wireMenu.x}
              y={wireMenu.y}
              items={wireMenuItems}
              onClose={() => setWireMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
