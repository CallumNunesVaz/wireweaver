import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
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
  Pencil,
  Sparkles,
  Trash2,
  SlidersHorizontal
} from 'lucide-react'
import { PinColumnNode, type PinColumnData } from './PinColumnNode'
import { TwistedPairEdge } from './TwistedPairEdge'
import { StripedWireEdge, type StripedWireData } from './StripedWireEdge'
import { SpliceNode, type SpliceNodeData } from './SpliceNode'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness } from '../model/derivation'
import { isWire, endLabel, type HarnessWire, type PinDef, type WirePart } from '../model/types'
import { codeSequence, codeColor, formatGauge, DIN_COLORS, COLOR_ABBREV_MAP, renderStripedColor } from '../model/wire'
import { imageUrl } from '../shared/useImage'
import { toast } from '../shared/toast'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { confirmDialog } from '../shared/dialogs'

const nodeTypes: NodeTypes = { pincol: PinColumnNode, splice: SpliceNode }
const edgeTypes = { twisted: TwistedPairEdge, striped: StripedWireEdge }

function isStripedColor(color: string | undefined): boolean {
  return !!color && color.startsWith('repeating-linear-gradient')
}

/** Convert a wire color (which may be a CSS gradient for striped wire)
 *  into a solid hex usable as an SVG stroke. */
function strokeSafe(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  if (color.startsWith('repeating-linear-gradient')) {
    const m = color.match(/#[0-9a-fA-F]{3,8}/)
    return m ? m[0] : fallback
  }
  return color
}

/** Extract two unique hex colors from a CSS gradient string for striped wire rendering. */
function parseStripeColors(gradient: string): { primary: string; secondary: string } | null {
  const matches = [...gradient.matchAll(/#[0-9a-fA-F]{3,8}/g)]
  const hexes = matches.map((m) => m[0])
  if (hexes.length < 2) return null
  const primary = hexes[0]
  const secondary = hexes.find((h) => h !== primary)
  return secondary ? { primary, secondary } : null
}

function parseHandle(h: string | null | undefined): { end: string; position: number } | null {
  if (!h) return null
  const clean = h.endsWith('-tgt') ? h.slice(0, -4) : h
  const parts = clean.split(':')
  if (parts.length !== 2) return null
  return { end: parts[0], position: Number(parts[1]) }
}

const COLOR_NAMES: Record<string, string> = {
  BK: 'Black', WH: 'White', GY: 'Grey', PK: 'Pink',
  RD: 'Red', OG: 'Orange', YE: 'Yellow', GN: 'Green',
  BU: 'Blue', VT: 'Violet', BN: 'Brown', TQ: 'Turquoise',
  LB: 'Light Blue', OL: 'Olive', BG: 'Beige', IV: 'Ivory',
  SL: 'Slate', CU: 'Copper', SN: 'Silver', SR: 'Silver Grey',
  GD: 'Gold', SP: 'Shield'
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
  const addSplice = useProjectStore((s) => s.addSplice)
  const removeSplice = useProjectStore((s) => s.removeSplice)
  const assignSpliceWire = useProjectStore((s) => s.assignSpliceWire)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)

  const [selectedWireIds, setSelectedWireIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [wireSearch, setWireSearch] = useState('')
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null)
  const [hideUnused, setHideUnused] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)
  const [wireMenu, setWireMenu] = useState<{ x: number; y: number } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

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
    const endpointNodes: Node[] = endpoints.map((_, i) => {
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
          matingConnectorName: re?.matingConnector?.name,
          pins: re?.pins ?? [],
          wiredPositions: [...(wiredPositions[label] ?? [])],
          hideUnused,
          pinColors: (re?.pins ?? []).map((p) => pinColors[`${label}:${p.position}`])
        } satisfies PinColumnData
      }
    })

    // Splice nodes positioned at visual center between the endpoints they join
    const spliceNodes: Node[] = (harness.splices ?? []).map((sp, idx) => {
      const pos = sp.position ?? {
        x: ((idx % cols) * COLUMN_SPACING) + COLUMN_SPACING / 2,
        y: Math.floor(idx / cols) * ROW_SPACING + ROW_SPACING / 2
      }
      return {
        id: `splice-${sp.id}`,
        type: 'splice',
        position: pos,
        data: {
          spliceId: sp.id,
          name: sp.name,
          wirePartId: sp.wirePartId,
          onDropWire: (spliceId: string, wp: WirePart) => assignSpliceWire(harnessId, spliceId, wp.id)
        } satisfies SpliceNodeData
      }
    })
    return [...endpointNodes, ...spliceNodes]
  }, [harness, numEndpoints, endpoints, resolvedEndpoints, wiredPositions, pinColors, hideUnused, harnessId, assignSpliceWire])

  // React Flow drives column motion locally; structure resyncs from the store.
  const [flowNodes, setFlowNodes, onNodesChangeRaw] = useNodesState<Node>([])
  const pendingNodeChanges = useRef<NodeChange[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    setFlowNodes(nodes)
  }, [nodes, setFlowNodes])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const immediate = changes.filter((c) => c.type !== 'position' || (c.type === 'position' && c.dragging === false))
      const dragPositions = changes.filter((c) => c.type === 'position' && c.dragging === true)

      if (immediate.length > 0) onNodesChangeRaw(immediate)

      for (const c of immediate) {
        if (c.type === 'position' && c.position) {
          const label = c.id.replace(/^end-/, '')
          const current = useProjectStore.getState().project.harnesses.find((h) => h.id === harnessId)
          updateHarness(harnessId, {
            layout: { ...(current?.layout ?? {}), [label]: c.position }
          })
        }
      }

      if (dragPositions.length > 0) {
        pendingNodeChanges.current.push(...dragPositions)
        if (rafRef.current === 0) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            const batch = pendingNodeChanges.current
            pendingNodeChanges.current = []
            onNodesChangeRaw(batch)
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
      const mate = w.twistedWith ? byId.get(w.twistedWith) : undefined
      const isTwisted = !!mate && mate.twistedWith === w.id

      // Striped wires get a custom edge type that renders two-colour bands.
      const isStriped = isStripedColor(w.color)
      const stripeData: StripedWireData | undefined = isStriped && w.color
        ? parseStripeColors(w.color) ?? undefined
        : undefined

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
      const baseColor = isStriped
        ? (stripeData?.primary ?? '#5b9bff')
        : strokeSafe(w.color, unassigned ? '#c48a2f' : '#5b9bff')

      const edgeType = isTwisted ? 'twisted' : isStriped ? 'striped' : undefined

      // Merge stripe data into twist data so TwistedPairEdge can render
      // two-colour bands when the wire has a striped colour.
      let edgeData: Record<string, unknown> | undefined
      if (isTwisted) {
        edgeData = stripeData
          ? { ...twistData, stripePrimary: stripeData.primary, stripeSecondary: stripeData.secondary }
          : twistData
      } else if (isStriped) {
        edgeData = stripeData
      }

      return {
        id: w.id,
        source: `end-${w.from.end}`,
        sourceHandle: `${w.from.end}:${w.from.position}`,
        target: `end-${w.to.end}`,
        targetHandle: `${w.to.end}:${w.to.position}-tgt`,
        selected: isSelected,
        type: edgeType,
        data: edgeData,
        style: {
          stroke: edgeType === 'striped' ? undefined : baseColor,
          strokeWidth: isSelected ? 3 : 2,
          strokeDasharray: unassigned && edgeType !== 'striped' ? '5 3' : undefined,
          opacity: isSelected ? 1 : 0.85,
          filter: isSelected ? `drop-shadow(0 0 5px ${baseColor}cc)` : undefined
        }
      }
    })
  }, [harness, allWires, selectedWireIds])

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const from = parseHandle(c.sourceHandle)
      const to = parseHandle(c.targetHandle)
      if (!from || !to) return false
      if (from.end === to.end && from.position === to.position) return false
      const latestWires = useProjectStore.getState().project.harnesses.find((h) => h.id === harnessId)?.wires ?? []
      const isWired = (end: string, position: number) =>
        latestWires.some(
          (w) =>
            (w.from.end === end && w.from.position === position) ||
            (w.to.end === end && w.to.position === position)
        )
      if (isWired(from.end, from.position)) return false
      if (isWired(to.end, to.position)) return false
      return true
    },
    [harnessId]
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

  const applyPartToSelected = useCallback(
    (wp: WirePart) => {
      if (!harness || selectedWireIds.length === 0) return
      const sel = new Set(selectedWireIds)
      setWires(
        harnessId,
        harness.wires.map((w) =>
          sel.has(w.id)
            ? { ...w, wirePartId: wp.id, color: wp.color ?? w.color }
            : w
        )
      )
    },
    [harness, selectedWireIds, harnessId, setWires]
  )

  const applyColorToSelected = useCallback(
    (color: string | undefined) => {
      if (!harness || selectedWireIds.length === 0) return
      const sel = new Set(selectedWireIds)
      setWires(
        harnessId,
        harness.wires.map((w) => (sel.has(w.id) ? { ...w, color } : w))
      )
    },
    [harness, selectedWireIds, harnessId, setWires]
  )

  const deleteSelectedWires = useCallback(() => {
    if (!harness || selectedWireIds.length === 0) return
    const sel = new Set(selectedWireIds)
    setWires(
      harnessId,
      harness.wires.filter((w) => !sel.has(w.id))
    )
    setSelectedWireIds([])
    setBulkOpen(false)
    setPopupPos(null)
  }, [harness, selectedWireIds, harnessId, setWires])

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
      const colors = wirePart.colorCode
        ? codeSequence(wirePart.colorCode, conductors).map((c) => codeColor(c))
        : new Array(conductors).fill(wirePart.color ?? undefined)
      const newStrands: HarnessWire[] = []
      for (let i = 0; i < conductors; i++) {
        newStrands.push({
          id: nanoid(),
          from: { ...old.from },
          to: { ...old.to },
          wirePartId: wirePart.id,
          color: colors[i],
          label: wirePart.colorCode
            ? codeSequence(wirePart.colorCode, conductors)[i]
            : undefined
        })
      }
      if (wirePart.shield) {
        newStrands.push({ id: nanoid(), from: { ...old.from }, to: { ...old.to }, wirePartId: wirePart.id, color: '#84878c', label: 'SHIELD' })
      }
      const updated = [...harness.wires]
      updated.splice(wireIdx, 1, ...newStrands)
      setWires(harnessId, updated)
      setSelectedWireIds([])
      setPopupPos(null)
    },
    [harness, harnessId, setWires]
  )

  /** Deploy a multi-core cable between two endpoint columns, auto-wiring
   * matching signal names. Each conductor gets a colour from the cable's
   * colour code. Remaining strands that can't match are wired to the first
   * unwired pin on each side. */
  const deployMultiCore = useCallback(
    (wirePart: WirePart) => {
      if (!harness || numEndpoints < 2) {
        toast('Need at least 2 endpoints to deploy a multi-core cable.', 'info')
        return
      }
      // Use the first two endpoint columns (most common case).
      const labelA = endLabel(0)
      const labelB = endLabel(1)
      const reA = resolvedEndpoints[0]
      const reB = resolvedEndpoints[1]
      if (!reA || !reB) return

      const conductors = wirePart.conductors ?? 1
      const colors: (string | undefined)[] = wirePart.colorCode
        ? codeSequence(wirePart.colorCode, conductors).map((c) => codeColor(c))
        : new Array(conductors).fill(wirePart.color ?? undefined)
      const labels: (string | undefined)[] = wirePart.colorCode
        ? codeSequence(wirePart.colorCode, conductors)
        : new Array(conductors).fill(undefined)

      const norm = (p: PinDef) => p.signal.trim().toLowerCase()
      const used = new Set(
        harness.wires.flatMap((w) => [
          `${w.from.end}:${w.from.position}`,
          `${w.to.end}:${w.to.position}`
        ])
      )

      const newStrands: HarnessWire[] = []
      const freeA = reA.pins.filter((p) => p.signalClass !== 'nc' && !used.has(`${labelA}:${p.position}`))
      const freeB = reB.pins.filter((p) => p.signalClass !== 'nc' && !used.has(`${labelB}:${p.position}`))

      for (let ci = 0; ci < conductors; ci++) {
        // Try to match by signal name.
        let matched = false
        for (const pa of [...freeA]) {
          const sa = norm(pa)
          if (!sa) continue
          const pbIdx = freeB.findIndex((pb) => norm(pb) === sa)
          if (pbIdx >= 0) {
            const pb = freeB[pbIdx]
            newStrands.push({
              id: nanoid(),
              from: { end: labelA, position: pa.position },
              to: { end: labelB, position: pb.position },
              wirePartId: wirePart.id,
              color: colors[ci],
              label: labels[ci]
            })
            freeA.splice(freeA.indexOf(pa), 1)
            freeB.splice(pbIdx, 1)
            matched = true
            break
          }
        }
        // Fallback: wire to first available pins on each side.
        if (!matched && freeA.length > 0 && freeB.length > 0) {
          const pa = freeA.shift()!
          const pb = freeB.shift()!
          newStrands.push({
            id: nanoid(),
            from: { end: labelA, position: pa.position },
            to: { end: labelB, position: pb.position },
            wirePartId: wirePart.id,
            color: colors[ci],
            label: labels[ci]
          })
        }
      }

      if (wirePart.shield && freeA.length > 0 && freeB.length > 0) {
        // Shield goes to a ground pin if possible, otherwise last free pin.
        const gndA = freeA.find((p) => p.signalClass === 'ground')
        const gndB = freeB.find((p) => p.signalClass === 'ground')
        if (gndA && gndB) {
          newStrands.push({ id: nanoid(), from: { end: labelA, position: gndA.position }, to: { end: labelB, position: gndB.position }, wirePartId: wirePart.id, color: '#84878c', label: 'SHIELD' })
        } else if (gndA && freeB.length > 0) {
          const pb = freeB.shift()!
          newStrands.push({ id: nanoid(), from: { end: labelA, position: gndA.position }, to: { end: labelB, position: pb.position }, wirePartId: wirePart.id, color: '#84878c', label: 'SHIELD' })
        } else if (gndB && freeA.length > 0) {
          const pa = freeA.shift()!
          newStrands.push({ id: nanoid(), from: { end: labelA, position: pa.position }, to: { end: labelB, position: gndB.position }, wirePartId: wirePart.id, color: '#84878c', label: 'SHIELD' })
        } else if (freeA.length > 0 && freeB.length > 0) {
          const pa = freeA.shift()!
          const pb = freeB.shift()!
          newStrands.push({ id: nanoid(), from: { end: labelA, position: pa.position }, to: { end: labelB, position: pb.position }, wirePartId: wirePart.id, color: '#84878c', label: 'SHIELD' })
        }
      }

      if (newStrands.length > 0) {
        setWires(harnessId, [...harness.wires, ...newStrands])
        toast(
          `Deployed "${wirePart.name}": ${newStrands.length} wire(s) between ${reA.instance.label} and ${reB.instance.label}.`,
          'success'
        )
      } else {
        toast('No free pins available for multi-core cable.', 'info')
      }
    },
    [harness, numEndpoints, resolvedEndpoints, harnessId, setWires]
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
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#14161b'
      const dataUrl = await toPng(el, { backgroundColor: bg })
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
      // Toggle membership so any number of wires can be bulk-edited.
      setSelectedWireIds((prev) =>
        prev.includes(ed.id) ? prev.filter((id) => id !== ed.id) : [...prev, ed.id]
      )
      setPopupPos(null)
    },
    []
  )

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, ed: Edge) => {
      e.preventDefault()
      setSelectedWireIds((prev) =>
        prev.includes(ed.id) ? prev : [...prev, ed.id]
      )
      setWireMenu({ x: e.clientX, y: e.clientY })
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


  const wireMenuItems: CtxItem[] = useMemo(() => {
    if (!wireMenu) return []
    const items: CtxItem[] = [
      {
        label: 'Edit Wire',
        icon: <Pencil size={14} />,
        onClick: () => { setWireMenu(null); setPopupPos({ x: 100, y: 100 }) }
      },
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => {
          setWires(harnessId, harness.wires.filter((w) => !selectedWireIds.includes(w.id)))
          setSelectedWireIds([]); setPopupPos(null); setWireMenu(null)
        }
      }
    ]
    if (canTwist) {
      items.unshift({
        label: areAlreadyTwisted ? 'Untwist pair' : 'Form twisted pair',
        icon: areAlreadyTwisted ? <Unlink2 size={14} /> : <Link2 size={14} />,
        onClick: () => { toggleTwistedPair(); setWireMenu(null) }
      })
    }
    return items
  }, [wireMenu, canTwist, areAlreadyTwisted, toggleTwistedPair, harnessId, harness.wires, selectedWireIds, setWires])

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
        <button
          className="ww-btn"
          onClick={() => {
            if (selectedWireIds.length >= 2) {
              addSplice(harnessId, selectedWireIds)
              setSelectedWireIds([])
              setPopupPos(null)
            } else {
              toast('Select at least 2 wires to splice them.', 'error')
            }
          }}
          title="Create splice from selected wires"
        >
          <Link2 size={15} /> Splice
        </button>
        {selectedWireIds.length > 0 && (
          <button
            className="ww-btn text-accent"
            onClick={() => setBulkOpen(true)}
            title="Bulk-edit the selected wires"
          >
            <SlidersHorizontal size={15} /> Edit {selectedWireIds.length}
          </button>
        )}
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
                      e.dataTransfer.setData('application/ww-multicore', String(wp.conductors ?? 1))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => {
                      const conductors = wp.conductors ?? 1
                      if (conductors > 1) {
                        deployMultiCore(wp)
                      } else if (singleWire) {
                        assignWirePart(wp, singleWire.id)
                      } else {
                        toast('Select a wire first, or deploy a multi-core cable onto the canvas.', 'info')
                      }
                    }}
                />
              ))}
            </div>
            <div className="border-t border-edge p-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted px-1">Harness Info</div>
              <textarea className="ww-input h-14 resize-none text-[11px]" placeholder="Description…" value={harness.description ?? ''} onChange={(e) => updateHarness(harnessId, { description: e.target.value })} />
              <textarea className="ww-input h-14 resize-none text-[11px]" placeholder="Notes…" value={harness.notes ?? ''} onChange={(e) => updateHarness(harnessId, { notes: e.target.value })} />
            </div>
            {(harness.splices ?? []).length > 0 && (
              <div className="border-t border-edge p-2 space-y-1.5">
                <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wide text-muted">
                  <Link2 size={12} /> Splices ({harness.splices!.length})
                </div>
                {harness.splices!.map((sp) => (
                  <div key={sp.id} className="rounded border border-edge bg-panelalt px-2 py-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{sp.name}</span>
                      <button
                        className="text-muted hover:text-[#e5484d]"
                        onClick={() => removeSplice(harnessId, sp.id)}
                        title="Remove splice"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <div className="text-muted">{sp.wireIds.length} wires</div>
                    {sp.wirePartId && <div className="text-accent">Wire part assigned</div>}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-edge px-2 py-1.5 text-[10px] text-muted">Drag onto a connection or splice · Click to assign</div>
          </aside>
        )}

        <div className="relative min-w-0 flex-1" ref={canvasRef}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/ww-harness-wire')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            } else {
              e.dataTransfer.dropEffect = 'none'
            }
          }}
          onDrop={async (e) => {
            const wpId = e.dataTransfer.getData('application/ww-harness-wire')
            if (!wpId) return
            e.preventDefault()
            const wp = parts.find((p) => isWire(p) && p.id === wpId) as WirePart | undefined
            if (!wp) return
            const conductors = wp.conductors ?? 1
            if (conductors > 1) {
              deployMultiCore(wp)
            } else if (selectedWireIds.length === 1) {
              assignWirePart(wp, selectedWireIds[0])
            } else {
              // Dropped a single-conductor wire with no selection — prompt.
              const autoWire = await confirmDialog({
                title: 'Auto-wire?',
                message: `No wire selected. Auto-wire "${wp.name}" between the first two endpoints?`,
                confirmLabel: 'Auto-wire'
              })
              if (autoWire) deployMultiCore(wp)
            }
          }}
        >
          <ReactFlowProvider>
            <ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onConnect={onConnect} onEdgesChange={onEdgesChange}
              isValidConnection={isValidConnection}
              onEdgeClick={onEdgeClick}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneClick={() => { setSelectedWireIds([]); setPopupPos(null) }}
              connectionLineStyle={{ stroke: '#5b9bff', strokeWidth: 2, strokeDasharray: '5 4', opacity: 0.8 }}
              connectionRadius={50} fitView fitViewOptions={{ padding: 0.3 }}
              deleteKeyCode={['Backspace', 'Delete']}
              selectNodesOnDrag={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-edge)" />
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

          {bulkOpen && selectedWires.length > 0 && (
            <BulkWirePanel
              selectedWires={selectedWires}
              wireParts={parts.filter(isWire)}
              onApplyPart={applyPartToSelected}
              onApplyColor={applyColorToSelected}
              onDelete={deleteSelectedWires}
              onClose={() => setBulkOpen(false)}
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

function BulkWirePanel({
  selectedWires,
  wireParts,
  onApplyPart,
  onApplyColor,
  onDelete,
  onClose
}: {
  selectedWires: HarnessWire[]
  wireParts: WirePart[]
  onApplyPart: (wp: WirePart) => void
  onApplyColor: (color: string | undefined) => void
  onDelete: () => void
  onClose: () => void
}) {
  const SWATCHES = ['BK', 'WH', 'RD', 'GN', 'BU', 'YE', 'OG', 'BN', 'GY', 'VT']
  return (
    <div className="absolute right-4 top-4 z-30 w-72 rounded-lg border border-edge bg-panel p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Edit {selectedWires.length} wires</span>
        <button className="text-muted hover:text-ink" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="mb-3 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-muted">
        {selectedWires.map((w) => (
          <div key={w.id} className="truncate">
            {w.from.end.toUpperCase()}
            {w.from.position} → {w.to.end.toUpperCase()}
            {w.to.position}
            {w.label ? ` · ${w.label}` : ''}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div>
          <label className="ww-label">Assign wire part to all</label>
          <select
            className="ww-input"
            defaultValue=""
            onChange={(e) => {
              const wp = wireParts.find((p) => p.id === e.target.value)
              if (wp) onApplyPart(wp)
            }}
          >
            <option value="">— choose —</option>
            {wireParts.map((wp) => (
              <option key={wp.id} value={wp.id}>
                {wp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ww-label">Set colour for all</label>
          <div className="flex flex-wrap items-center gap-1">
            {SWATCHES.map((abbr) => {
              const hex = COLOR_ABBREV_MAP[abbr]
              return (
                <button
                  key={abbr}
                  className="h-6 w-6 rounded border border-edge hover:border-accent"
                  style={{ background: hex }}
                  title={abbr}
                  onClick={() => onApplyColor(hex)}
                />
              )
            })}
            <button className="ww-btn text-[11px]" onClick={() => onApplyColor(undefined)}>
              Clear
            </button>
          </div>
        </div>
        <button className="ww-btn w-full text-[#e5484d]" onClick={onDelete}>
          <Trash2 size={14} /> Delete {selectedWires.length} wires
        </button>
      </div>
    </div>
  )
}

const WirePartCard = memo(function WirePartCard({ part, gaugeDisplay, colors, onDragStart, onClick }: {
  part: WirePart
  gaugeDisplay?: string
  colors?: string[]
  onDragStart: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const img = imageUrl(part.imageHash, 'thumb')
  const conductors = part.conductors ?? 1
  const isMultiCore = conductors > 1

  // Build a full colour swatch strip for the cable.
  const fullColors: string[] = part.colorCode
    ? codeSequence(part.colorCode, conductors)
    : []
  const swatchCount = Math.min(fullColors.length || conductors, 12)

  return (
    <div
      className="group flex cursor-grab flex-col gap-1 rounded border p-1.5 transition-colors hover:border-accent active:cursor-grabbing"
      style={{
        borderColor: isMultiCore ? 'var(--color-edge)' : undefined,
        background: isMultiCore ? 'linear-gradient(135deg, var(--color-panelalt) 0%, var(--color-panelalt) 50%, var(--color-accent)/0.04 100%)' : undefined
      }}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={`${part.name}${part.shield ? ' · shielded' : ''}${isMultiCore ? ` · ${conductors}-core` : ''}${part.colorCode ? ` · ${part.colorCode}` : ''}`}
    >
      {/* Top row: icon + name */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
          {img ? <img src={img} className="h-full w-full object-cover" alt="" /> : part.shield ? <Shield size={11} className="text-muted" /> : <Cable size={11} className="text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium leading-tight">{part.name}</div>
        </div>
        {isMultiCore && <Sparkles size={11} className="text-accent shrink-0" />}
      </div>

      {/* Second row: meta */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted pl-8">
        {gaugeDisplay && <span>{gaugeDisplay}</span>}
        {isMultiCore && <span className="rounded bg-accent/15 px-1 text-accent font-medium">{conductors}×</span>}
        {part.shield && <Shield size={9} className="text-[#c48a2f]" />}
        {part.category === 'bundle' && <span className="rounded bg-[#c48a2f]/20 px-1 text-[#c48a2f]">bundle</span>}
        {part.colorCode && <span className="rounded bg-panelalt px-1">{part.colorCode}</span>}
      </div>

      {/* Colour swatch strip — multi-core cables get expanded strip */}
      {isMultiCore && fullColors.length > 0 && (
        <div className="pl-8 pt-0.5">
          <div className="flex gap-0.5 flex-wrap">
            {fullColors.slice(0, swatchCount).map((abbr, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-sm px-1 text-[9px] font-medium leading-tight"
                style={{ background: codeColor(abbr) + '20', color: codeColor(abbr), border: `1px solid ${codeColor(abbr)}40` }}
                title={`${abbr}${COLOR_NAMES[abbr] ? ' — ' + COLOR_NAMES[abbr] : ''}`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ background: codeColor(abbr), border: '1px solid rgba(255,255,255,0.3)' }}
                />
                {abbr}
              </span>
            ))}
            {fullColors.length > swatchCount && (
              <span className="text-[9px] text-muted self-center">+{fullColors.length - swatchCount} more</span>
            )}
          </div>
        </div>
      )}

      {/* Single-core: simple swatch dots */}
      {!isMultiCore && colors && colors.length > 0 && (
        <div className="pl-8 pt-0.5">
          <span className="flex items-center gap-0.5">
            {colors.slice(0, 4).map((c, i) => (
              <span key={i} className="inline-block h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: codeColor(c) }} />
            ))}
            {colors.length > 4 && <span className="text-[8px] text-muted">+</span>}
          </span>
        </div>
      )}
    </div>
  )
})

function WireEditPopup({ selectedWires, wireParts, pos, canTwist, areAlreadyTwisted, isTwisted, onClose, onUpdate, onAssign, onToggleTwist }: {
  selectedWires: HarnessWire[]
  wireParts: WirePart[]
  pos: { x: number; y: number }
  canTwist: boolean; areAlreadyTwisted: boolean; isTwisted: boolean
  onClose: () => void; onUpdate: (p: Partial<HarnessWire>) => void
  onAssign: (wp: WirePart) => void; onToggleTwist: () => void
}) {
  const [open, setOpen] = useState(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest?.('.react-flow__edge')) return
      const el = document.getElementById('ww-wire-popup')
      if (el && !el.contains(target)) onCloseRef.current()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', listener), 100)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', listener) }
  }, [])
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

// ---------- Colour swatch picker ----------

/** The first 10 DIN 47100 colours used as the primary swatch palette. */
const DIN_SWATCHES = DIN_COLORS.slice(0, 10)

/** Common pairs used as striped presets. */
const STRIPED_PRESETS: [string, string][] = [
  ['WH', 'RD'], ['YE', 'GN'], ['BK', 'WH'], ['BN', 'BU'],
  ['RD', 'BK'], ['OG', 'WH'], ['GN', 'YE'], ['BU', 'GN'],
  ['WH', 'GN'], ['GY', 'PK'], ['VT', 'WH'], ['BN', 'YE']
]

function ColorSwatchPicker({ currentColor, onChange }: {
  currentColor: string | undefined
  onChange: (color: string | undefined) => void
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [customColor, setCustomColor] = useState('#5b9bff')

  return (
    <div className="space-y-2">
      {/* DIN solid colour row */}
      <div className="text-[10px] text-muted">Solid (DIN 47100)</div>
      <div className="flex flex-wrap gap-1">
        {DIN_SWATCHES.map((abbr) => {
          const hex = COLOR_ABBREV_MAP[abbr]
          const selected = !isStripedColor(currentColor) && currentColor === hex
          return (
            <button
              key={abbr}
              className={`relative h-6 w-6 rounded border-2 transition-transform hover:scale-110 ${
                selected ? 'border-accent scale-110' : 'border-edge hover:border-accent/50'
              }`}
              style={{ background: hex }}
              title={`${abbr}${COLOR_NAMES[abbr] ? ' — ' + COLOR_NAMES[abbr] : ''}`}
              onClick={() => onChange(hex)}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold" style={{ color: hex === '#000000' || hex === '#8000ff' || hex === '#0066ff' ? 'white' : 'black' }}>✓</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Striped pairs row */}
      <div className="text-[10px] text-muted">Striped</div>
      <div className="flex flex-wrap gap-1">
        {STRIPED_PRESETS.map(([p, s]) => {
          const primary = COLOR_ABBREV_MAP[p]
          const secondary = COLOR_ABBREV_MAP[s]
          const gradient = renderStripedColor({ primary, secondary })
          const selected = currentColor === gradient
          return (
            <button
              key={`${p}/${s}`}
              className={`relative h-6 w-6 rounded border-2 transition-transform hover:scale-110 ${
                selected ? 'border-accent scale-110' : 'border-edge hover:border-accent/50'
              }`}
              style={{ background: gradient }}
              title={`${p}/${s}${COLOR_NAMES[p] ? ' — ' + COLOR_NAMES[p] : ''}/${COLOR_NAMES[s] ?? ''}`}
              onClick={() => onChange(gradient)}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white drop-shadow">✓</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Custom picker + clear */}
      <div className="flex items-center gap-1">
        <button
          className="ww-btn text-[11px]"
          onClick={() => setShowCustom(!showCustom)}
          title="Custom colour…"
        >
          🎨 Custom
        </button>
        {currentColor && (
          <button
            className="ww-btn text-[11px] text-muted hover:text-ink"
            onClick={() => onChange(undefined)}
            title="Clear colour"
          >
            Clear
          </button>
        )}
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 rounded border border-edge bg-panelalt p-2">
          <input
            type="color"
            className="h-7 w-10 rounded border border-edge cursor-pointer"
            value={isStripedColor(currentColor) ? customColor : (currentColor ?? customColor)}
            onChange={(e) => {
              setCustomColor(e.target.value)
              onChange(e.target.value)
            }}
          />
          <span className="text-[10px] text-muted truncate flex-1">
            {isStripedColor(currentColor)
              ? 'Striped (custom colour for preview)'
              : currentColor || 'No colour set'}
          </span>
          <button
            className="text-[10px] text-muted hover:text-ink"
            onClick={() => { setShowCustom(false) }}
          >
            <X size={12} />
          </button>
        </div>
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
          <ColorSwatchPicker
            currentColor={wire.color}
            onChange={(color) => onUpdate({ color })}
          />
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
