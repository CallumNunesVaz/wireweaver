import { useCallback, useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type Connection,
  type EdgeChange,
  type NodeTypes
} from '@xyflow/react'
import { Zap, Eraser, X, AlertTriangle } from 'lucide-react'
import { PinColumnNode, type PinColumnData } from './PinColumnNode'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { resolveEndpoint, validateHarness } from '../model/derivation'
import { isWire, type HarnessWire, type PinDef } from '../model/types'

const nodeTypes: NodeTypes = { pincol: PinColumnNode }

function parseHandle(h: string | null | undefined): { end: 'a' | 'b'; position: number } | null {
  if (!h) return null
  const [end, pos] = h.split(':')
  if (end !== 'a' && end !== 'b') return null
  return { end, position: Number(pos) }
}

export function HarnessEditor({ harnessId }: { harnessId: string }) {
  const close = useUiStore((s) => s.closeHarnessEditor)
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === harnessId))
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const setWires = useProjectStore((s) => s.setHarnessWires)
  const updateHarness = useProjectStore((s) => s.updateHarness)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)

  const [selectedWireId, setSelectedWireId] = useState<string | null>(null)

  // Esc returns to the Assembly View (matches the on-canvas hint and the plan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const lib = useMemo(
    () => selectLibraryLike({ parts, templates }),
    [parts, templates]
  )
  const wireParts = useMemo(() => parts.filter(isWire), [parts])

  const a = useMemo(
    () => (harness ? resolveEndpoint(lib, instances, harness.a) : undefined),
    [harness, lib, instances]
  )
  const b = useMemo(
    () => (harness ? resolveEndpoint(lib, instances, harness.b) : undefined),
    [harness, lib, instances]
  )
  const validation = useMemo(
    () => (harness ? validateHarness(lib, instances, harness) : null),
    [harness, lib, instances]
  )

  const wiredPositions = useMemo(() => {
    const set = { a: new Set<number>(), b: new Set<number>() }
    for (const w of harness?.wires ?? []) {
      set[w.from.end].add(w.from.position)
      set[w.to.end].add(w.to.position)
    }
    return set
  }, [harness?.wires])

  const nodes: Node[] = useMemo(() => {
    if (!harness) return []
    const mk = (
      end: 'a' | 'b',
      re: typeof a,
      x: number
    ): Node => ({
      id: `end-${end}`,
      type: 'pincol',
      position: { x, y: 0 },
      draggable: false,
      data: {
        end,
        title: re ? `${re.instance.label} · ${re.port.name}` : `End ${end.toUpperCase()}`,
        connectorName: re?.connector?.name ?? 'no connector',
        pins: re?.pins ?? [],
        wiredPositions: [...wiredPositions[end]]
      } satisfies PinColumnData
    })
    return [mk('a', a, 0), mk('b', b, 420)]
  }, [harness, a, b, wiredPositions])

  const edges: Edge[] = useMemo(() => {
    if (!harness) return []
    return harness.wires.map((w) => ({
      id: w.id,
      source: `end-${w.from.end}`,
      sourceHandle: `${w.from.end}:${w.from.position}`,
      target: `end-${w.to.end}`,
      targetHandle: `${w.to.end}:${w.to.position}`,
      selected: w.id === selectedWireId,
      style: {
        stroke: w.color ?? '#5b9bff',
        strokeWidth: w.id === selectedWireId ? 3 : 2
      }
    }))
  }, [harness, selectedWireId])

  const pinWired = useCallback(
    (end: 'a' | 'b', position: number) =>
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
      const to = parseHandle(c.targetHandle)
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
        setWires(
          harnessId,
          harness.wires.filter((w) => !removed.includes(w.id))
        )
      }
    },
    [harness, harnessId, setWires]
  )

  const autoWire = useCallback(() => {
    if (!harness || !a || !b) return
    const norm = (p: PinDef) => p.signal.trim().toLowerCase()
    const existing = new Set(
      harness.wires.flatMap((w) => [
        `${w.from.end}:${w.from.position}`,
        `${w.to.end}:${w.to.position}`
      ])
    )
    const added: HarnessWire[] = []
    for (const pa of a.pins) {
      const sa = norm(pa)
      if (!sa || pa.signalClass === 'nc') continue
      if (existing.has(`a:${pa.position}`)) continue
      const match = b.pins.find(
        (pb) =>
          norm(pb) === sa &&
          !existing.has(`b:${pb.position}`) &&
          pb.signalClass !== 'nc'
      )
      if (match) {
        added.push({
          id: nanoid(),
          from: { end: 'a', position: pa.position },
          to: { end: 'b', position: match.position }
        })
        existing.add(`a:${pa.position}`)
        existing.add(`b:${match.position}`)
      }
    }
    if (added.length) setWires(harnessId, [...harness.wires, ...added])
  }, [harness, a, b, harnessId, setWires])

  const clearWires = useCallback(() => {
    if (harness) setWires(harnessId, [])
    setSelectedWireId(null)
  }, [harness, harnessId, setWires])

  const updateSelectedWire = useCallback(
    (patch: Partial<HarnessWire>) => {
      if (!harness || !selectedWireId) return
      setWires(
        harnessId,
        harness.wires.map((w) => (w.id === selectedWireId ? { ...w, ...patch } : w))
      )
    },
    [harness, selectedWireId, harnessId, setWires]
  )

  if (!harness) return null
  const selectedWire = harness.wires.find((w) => w.id === selectedWireId)

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
        <div className="flex items-center gap-1">
          <span className="ww-label mb-0">Length</span>
          <input
            type="number"
            className="ww-input w-24"
            placeholder="mm"
            value={harness.lengthMm ?? ''}
            onChange={(e) =>
              updateHarness(harnessId, {
                lengthMm: e.target.value ? Number(e.target.value) : undefined
              })
            }
          />
        </div>
        <button className="ww-btn" onClick={autoWire} title="Auto-wire matching signal names">
          <Zap size={15} /> Auto-wire
        </button>
        <button className="ww-btn" onClick={clearWires} title="Clear all wires">
          <Eraser size={15} /> Clear
        </button>

        {validation && validation.warnings.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[#e0b25c]">
            <AlertTriangle size={13} /> {validation.warnings.length} warning(s)
          </span>
        )}

        <button className="ww-btn-primary ml-auto" onClick={close}>
          <X size={15} /> Done
        </button>
      </div>

      {/* Canvas */}
      <div className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            isValidConnection={isValidConnection}
            onEdgeClick={(_, ed) => setSelectedWireId(ed.id)}
            onPaneClick={() => setSelectedWireId(null)}
            connectionRadius={30}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a2f3a" />
            <Controls showInteractive={false} />
          </ReactFlow>

          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-muted">
            Drag pin → pin to add a wire · select a wire to assign part/colour · Delete to remove · Esc to close
          </div>
        </ReactFlowProvider>
      </div>

      {/* Selected wire assignment */}
      {selectedWire && (
        <div className="flex items-center gap-3 border-t border-edge px-3 py-2">
          <span className="text-xs font-medium">
            Wire {selectedWire.from.end.toUpperCase()}
            {selectedWire.from.position} → {selectedWire.to.end.toUpperCase()}
            {selectedWire.to.position}
          </span>
          <div className="flex items-center gap-1">
            <span className="ww-label mb-0">Wire part</span>
            <select
              className="ww-input w-56"
              value={selectedWire.wirePartId ?? ''}
              onChange={(e) =>
                updateSelectedWire({ wirePartId: e.target.value || undefined })
              }
            >
              <option value="">—</option>
              {wireParts.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.gauge ? ` (${w.gauge})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="ww-label mb-0">Colour</span>
            <input
              type="color"
              className="h-7 w-10 rounded border border-edge bg-panelalt"
              value={selectedWire.color ?? '#5b9bff'}
              onChange={(e) => updateSelectedWire({ color: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
