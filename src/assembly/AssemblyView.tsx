import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  useNodesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes
} from '@xyflow/react'
import { nanoid } from 'nanoid'
import { LayoutGrid, Cpu, Maximize2, Copy, Trash2, Pencil, Cable, ExternalLink } from 'lucide-react'
import { DeviceNode } from './DeviceNode'
import { HarnessEdge } from './HarnessEdge'
import { autoLayout } from './autoLayout'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore, coalesceUndo } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { validateHarness, type HarnessValidation } from '../model/derivation'
import { isDevice } from '../model/types'

const nodeTypes: NodeTypes = { device: DeviceNode }
const edgeTypes: EdgeTypes = { harness: HarnessEdge }

type Menu =
  | { x: number; y: number; kind: 'pane' }
  | { x: number; y: number; kind: 'node' | 'edge'; id: string }

export function AssemblyView() {
  const { screenToFlowPosition, fitView } = useReactFlow()

  const instances = useProjectStore((s) => s.project.deviceInstances)
  const harnesses = useProjectStore((s) => s.project.harnesses)
  const addInstance = useProjectStore((s) => s.addInstance)
  const updatePos = useProjectStore((s) => s.updateInstancePosition)
  const removeInstance = useProjectStore((s) => s.removeInstance)
  const duplicateInstance = useProjectStore((s) => s.duplicateInstance)
  const removeHarness = useProjectStore((s) => s.removeHarness)
  const addHarness = useProjectStore((s) => s.addHarness)

  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)

  const selection = useUiStore((s) => s.selection)
  const select = useUiStore((s) => s.select)
  const setHoverHarness = useUiStore((s) => s.setHoverHarness)
  const hoverHarnessId = useUiStore((s) => s.hoverHarnessId)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const openPartEditor = useUiStore((s) => s.openPartEditor)

  const [menu, setMenu] = useState<Menu | null>(null)

  // React Flow drives node motion locally; we resync structure/positions from
  // the store whenever the instance list changes (add/remove/undo/redo).
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>([])

  useEffect(() => {
    setNodes(
      instances.map((inst) => ({
        id: inst.id,
        type: 'device',
        position: inst.position,
        data: { instanceId: inst.id },
        selected: selection?.type === 'instance' && selection.id === inst.id
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances])

  const lib = useMemo(
    () => selectLibraryLike({ parts, templates }),
    [parts, templates]
  )

  // Validation is memoized on real model changes only — hover/selection churn
  // must not re-run it for every harness.
  const validations = useMemo(() => {
    const m = new Map<string, HarnessValidation>()
    for (const h of harnesses) m.set(h.id, validateHarness(lib, instances, h))
    return m
  }, [harnesses, instances, lib])

  const edges: Edge[] = useMemo(
    () =>
      harnesses.map((h) => {
        const v = validations.get(h.id)
        return {
          id: h.id,
          source: h.a.deviceInstanceId,
          sourceHandle: h.a.portId,
          target: h.b.deviceInstanceId,
          targetHandle: h.b.portId,
          type: 'harness',
          selected: selection?.type === 'harness' && selection.id === h.id,
          data: {
            name: h.name,
            status: v?.status ?? 'unwired',
            wireCount: v?.wireCount ?? 0,
            hovered: hoverHarnessId === h.id
          }
        }
      }),
    [harnesses, validations, selection, hoverHarnessId]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRaw(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) {
          updatePos(c.id, c.position)
        } else if (c.type === 'remove') {
          removeInstance(c.id)
        }
      }
    },
    [onNodesChangeRaw, updatePos, removeInstance]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) if (c.type === 'remove') removeHarness(c.id)
    },
    [removeHarness]
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target) return false
      if (c.source === c.target) return false
      const occupied = (deviceInstanceId: string, portId: string | null | undefined) =>
        harnesses.some(
          (h) =>
            (h.a.deviceInstanceId === deviceInstanceId && h.a.portId === portId) ||
            (h.b.deviceInstanceId === deviceInstanceId && h.b.portId === portId)
        )
      if (occupied(c.source, c.sourceHandle)) return false
      if (occupied(c.target, c.targetHandle)) return false
      return true
    },
    [harnesses]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle || !c.targetHandle) return
      const id = addHarness(
        { deviceInstanceId: c.source, portId: c.sourceHandle },
        { deviceInstanceId: c.target, portId: c.targetHandle }
      )
      if (id) select({ type: 'harness', id })
    },
    [addHarness, select]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })

      // Template drop onto a device node — adds port to the device part.
      const templateId = e.dataTransfer.getData('application/ww-template')
      if (templateId) {
        const hit = instances.find(
          (inst) =>
            position.x >= inst.position.x &&
            position.x <= inst.position.x + 180 &&
            position.y >= inst.position.y &&
            position.y <= inst.position.y + 110
        )
        if (hit) {
          const lib = useLibraryStore.getState()
          const devPart = lib.parts.find((p) => p.id === hit.partId)
          if (devPart && isDevice(devPart)) {
            const tpl = lib.templates.find((t) => t.id === templateId)
            const defaultName = tpl?.name ?? `Port ${devPart.ports.length + 1}`
            const portName = window.prompt('Port name:', defaultName)
            if (!portName || !portName.trim()) return
            const newPort = {
              id: nanoid(),
              name: portName.trim(),
              pinoutTemplateId: templateId,
              side: 'right' as const
            }
            lib.upsertPart({ ...devPart, ports: [...devPart.ports, newPort] })
            useUiStore.getState().select({ type: 'instance', id: hit.id })
          }
        }
        return
      }

      // Part drop — only devices instantiate on the canvas.
      const partId = e.dataTransfer.getData('application/ww-part')
      if (!partId) return
      const part = parts.find((p) => p.id === partId)
      if (!part || !isDevice(part)) return
      const count = instances.filter((i) => i.partId === partId).length
      const label = count > 0 ? `${part.name} ${count + 1}` : part.name
      const id = addInstance(partId, position, label)
      select({ type: 'instance', id })
    },
    [parts, instances, screenToFlowPosition, addInstance, select]
  )

  const onEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, ed: Edge) => {
      const h = harnesses.find((x) => x.id === ed.id)
      setHoverHarness(
        ed.id,
        h
          ? [
              { instanceId: h.a.deviceInstanceId, portId: h.a.portId },
              { instanceId: h.b.deviceInstanceId, portId: h.b.portId }
            ]
          : []
      )
    },
    [harnesses, setHoverHarness]
  )

  const runAutoLayout = useCallback(() => {
    const positions = autoLayout(instances, harnesses)
    for (const [id, pos] of Object.entries(positions)) updatePos(id, pos)
  }, [instances, harnesses, updatePos])

  // Arrow-key nudge for the selected device; coalesced so holding a key makes
  // one undo step, not dozens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sel = useUiStore.getState().selection
      if (!sel || sel.type !== 'instance') return
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return
      let dx = 0
      let dy = 0
      const step = e.shiftKey ? 10 : 1
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      const st = useProjectStore.getState()
      const inst = st.project.deviceInstances.find((i) => i.id === sel.id)
      if (inst) {
        coalesceUndo(() =>
          st.updateInstancePosition(sel.id, {
            x: inst.position.x + dx,
            y: inst.position.y + dy
          })
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasDevices = parts.some(isDevice)

  const menuItems: CtxItem[] = useMemo(() => {
    if (!menu) return []
    if (menu.kind === 'pane') {
      return [
        {
          label: 'Fit view',
          icon: <Maximize2 size={14} />,
          onClick: () => fitView({ padding: 0.3, duration: 300 })
        },
        {
          label: 'Auto-layout',
          icon: <LayoutGrid size={14} />,
          onClick: runAutoLayout
        }
      ]
    }
    if (menu.kind === 'node') {
      const inst = useProjectStore.getState().project.deviceInstances.find((i) => i.id === menu.id)
      const part = inst ? useLibraryStore.getState().parts.find((p) => p.id === inst.partId) : undefined
      return [
        {
          label: 'Edit part',
          icon: <ExternalLink size={14} />,
          disabled: !part,
          onClick: () => {
            if (part) openPartEditor({ kind: part.kind, partId: part.id })
          }
        },
        {
          label: 'Rename',
          icon: <Pencil size={14} />,
          onClick: () => {
            if (!inst) return
            const label = window.prompt('Instance label:', inst.label)
            if (label && label.trim()) {
              useProjectStore.getState().setInstanceLabel(menu.id, label.trim())
            }
          }
        },
        {
          label: 'Duplicate',
          icon: <Copy size={14} />,
          onClick: () => duplicateInstance(menu.id)
        },
        {
          label: 'Delete',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => {
            removeInstance(menu.id)
            select(null)
          }
        }
      ]
    }
    return [
      {
        label: 'Edit harness',
        icon: <Pencil size={14} />,
        onClick: () => openHarnessEditor(menu.id)
      },
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => {
          removeHarness(menu.id)
          select(null)
        }
      }
    ]
  }, [
    menu,
    fitView,
    runAutoLayout,
    duplicateInstance,
    removeInstance,
    removeHarness,
    openHarnessEditor,
    openPartEditor,
    select
  ])

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, n) => select({ type: 'instance', id: n.id })}
        onEdgeClick={(_, ed) => select({ type: 'harness', id: ed.id })}
        onEdgeDoubleClick={(_, ed) => openHarnessEditor(ed.id)}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={() => setHoverHarness(null)}
        onPaneClick={() => select(null)}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, kind: 'pane' })
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault()
          select({ type: 'instance', id: n.id })
          setMenu({ x: e.clientX, y: e.clientY, kind: 'node', id: n.id })
        }}
        onEdgeContextMenu={(e, ed) => {
          e.preventDefault()
          select({ type: 'harness', id: ed.id })
          setMenu({ x: e.clientX, y: e.clientY, kind: 'edge', id: ed.id })
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        connectionRadius={30}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a2f3a" />
        <MiniMap
          pannable
          zoomable
          nodeColor="#2f343f"
          maskColor="rgba(0,0,0,0.55)"
          style={{ background: '#1b1e24' }}
        />
        <Controls />
      </ReactFlow>

      <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-2">
        <button
          className="ww-btn pointer-events-auto"
          onClick={runAutoLayout}
          title="Auto-layout (dagre)"
        >
          <LayoutGrid size={15} /> Auto-layout
        </button>
        <button
          className="ww-btn pointer-events-auto"
          onClick={() => fitView({ padding: 0.3, duration: 300 })}
          title="Fit view"
        >
          <Maximize2 size={15} /> Fit
        </button>
      </div>

      {instances.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted">
            {hasDevices ? <Cpu size={28} /> : <Cable size={28} />}
            <div className="text-sm">
              {hasDevices
                ? 'Drag a device from the library onto the canvas'
                : 'Create a device in the library, then drag it here'}
            </div>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
