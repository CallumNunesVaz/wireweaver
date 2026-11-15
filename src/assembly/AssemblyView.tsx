import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes
} from '@xyflow/react'
import { nanoid } from 'nanoid'
import { LayoutGrid, Cpu, Maximize2, Copy, Trash2, Pencil, Cable, ExternalLink, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical } from 'lucide-react'
import { DeviceNode } from './DeviceNode'
import { HarnessEdge } from './HarnessEdge'
import { autoLayout } from './autoLayout'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { toast } from '../shared/toast'
import { promptDialog } from '../shared/dialogs'
import { useLibraryStore } from '../stores/libraryStore'
import { useEffectiveLibrary } from '../stores/effectiveLibrary'
import { useAnyOverlayOpen, isTextTarget, topOverlay } from '../shared/overlay'
import { useRafNodeChanges } from '../shared/useRafNodeChanges'
import { useProjectStore, coalesceUndo } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { validateHarness, type HarnessValidation } from '../model/derivation'
import { isDevice, type DeviceInstance, type HarnessEndpoint } from '../model/types'

const nodeTypes: NodeTypes = { device: DeviceNode }
const edgeTypes: EdgeTypes = { harness: HarnessEdge }

type Menu =
  | { x: number; y: number; kind: 'pane' }
  | { x: number; y: number; kind: 'node' | 'edge'; id: string }

export function AssemblyView() {
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow()
  const overlayOpen = useAnyOverlayOpen()
  const fitViewRequest = useUiStore((s) => s.fitViewRequest)

  const instances = useProjectStore((s) => s.project.deviceInstances)
  const harnesses = useProjectStore((s) => s.project.harnesses)
  const addInstance = useProjectStore((s) => s.addInstance)
  const updatePositions = useProjectStore((s) => s.updateInstancePositions)
  const removeInstance = useProjectStore((s) => s.removeInstance)
  const removeInstances = useProjectStore((s) => s.removeInstances)
  const duplicateInstance = useProjectStore((s) => s.duplicateInstance)
  const removeHarness = useProjectStore((s) => s.removeHarness)

  const { lib, parts } = useEffectiveLibrary()

  const selection = useUiStore((s) => s.selection)
  const multiSelectedIds = useUiStore((s) => s.multiSelectedIds)
  const toggleMultiSelect = useUiStore((s) => s.toggleMultiSelect)
  const select = useUiStore((s) => s.select)
  const setHoverHarness = useUiStore((s) => s.setHoverHarness)
  const hoverHarnessId = useUiStore((s) => s.hoverHarnessId)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const openPartEditor = useUiStore((s) => s.openPartEditor)

  const [menu, setMenu] = useState<Menu | null>(null)
  const [connectSource, setConnectSource] = useState<{
    instanceId: string
    portId: string
  } | null>(null)
  const isDragging = useRef(false)

  // React Flow drives node motion locally; we resync structure/positions from
  // the store whenever the instance list changes (add/remove/undo/redo).
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>([])

  // Drag frames batch to one render per animation frame; drag end commits
  // every moved node as a single undo step.
  const onNodesChange = useRafNodeChanges(
    onNodesChangeRaw,
    (moves) => updatePositions(moves),
    (ids) => {
      removeInstances(ids)
      select(null)
    }
  )

  useEffect(() => {
    if (isDragging.current) return
    setNodes(
      instances.map((inst) => ({
        id: inst.id,
        type: 'device',
        position: inst.position,
        data: {
          instanceId: inst.id,
          connectSource
        },
        selected:
          selection?.type === 'instance' &&
          (selection.id === inst.id || multiSelectedIds.includes(inst.id))
      }))
    )
  }, [instances, connectSource, selection, multiSelectedIds, setNodes])

  const validations = useMemo(() => {
    const m = new Map<string, HarnessValidation>()
    for (const h of harnesses) m.set(h.id, validateHarness(lib, instances, h))
    return m
  }, [harnesses, instances, lib])

  const edges: Edge[] = useMemo(
    () => {
      const out: Edge[] = []
      for (const h of harnesses) {
        const v = validations.get(h.id)
        const eps = h.endpoints
        if (eps.length < 2) continue
        const root = eps[0]
        for (let i = 1; i < eps.length; i++) {
          const ep = eps[i]
          out.push({
            id: `${h.id}-seg-${i}`,
            source: root.deviceInstanceId,
            sourceHandle: root.portId,
            target: ep.deviceInstanceId,
            targetHandle: `${ep.portId}-tgt`,
            type: 'harness',
            selected: selection?.type === 'harness' && selection.id === h.id,
            data: {
              harnessId: h.id,
              name: h.name,
              status: v?.status ?? 'unwired',
              wireCount: v?.wireCount ?? 0,
              hovered: hoverHarnessId === h.id,
              showLabel: i === 1
            }
          })
        }
      }
      return out
    },
    [harnesses, validations, selection, hoverHarnessId]
  )

  const edgesRef = useRef(edges)
  edgesRef.current = edges

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove') {
          // React Flow also emits edge removals for edges attached to a
          // deleted device; those are pruned by removeInstances instead of
          // deleting the whole (possibly multi-endpoint) harness.
          const edge = edgesRef.current.find((e) => e.id === c.id)
          if (edge?.selected && edge.data?.harnessId) removeHarness(edge.data.harnessId as string)
        }
      }
    },
    [removeHarness]
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target) return false
      if (c.source === c.target) return false
      return true
    },
    []
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle || !c.targetHandle) return
      const targetPortId = c.targetHandle.endsWith('-tgt')
        ? c.targetHandle.slice(0, -4)
        : c.targetHandle

      const ep1: HarnessEndpoint = { deviceInstanceId: c.source, portId: c.sourceHandle }
      const ep2: HarnessEndpoint = { deviceInstanceId: c.target, portId: targetPortId }

      const st = useProjectStore.getState()
      const existing1 = st.findHarnessByEndpoint(ep1.deviceInstanceId, ep1.portId)
      const existing2 = st.findHarnessByEndpoint(ep2.deviceInstanceId, ep2.portId)

      // A port belongs to at most one harness: joining two existing harnesses
      // would put ports in both, so refuse instead of silently merging.
      if (existing1 && existing2) {
        if (existing1 !== existing2) {
          toast('Both ports already belong to different harnesses.', 'error')
        }
        return
      }
      const existingId = existing1 ?? existing2
      if (existingId) {
        st.addEndpointToHarness(existingId, existing1 ? ep2 : ep1)
        select({ type: 'harness', id: existingId })
        return
      }

      const id = st.addHarness([ep1, ep2])
      if (id) select({ type: 'harness', id })
    },
    [select]
  )

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })

      // Template drop onto a device node — adds port to the device part.
      const templateId = e.dataTransfer.getData('application/ww-template')
      if (templateId) {
        const node = getNodes().find((n) => {
          const w = n.measured?.width ?? 180
          const h = n.measured?.height ?? 110
          return (
            position.x >= n.position.x &&
            position.x <= n.position.x + w &&
            position.y >= n.position.y &&
            position.y <= n.position.y + h
          )
        })
        const hit = node ? instances.find((i) => i.id === node.id) : undefined
        if (!hit) {
          toast('Drop a pinout template onto a placed device to add a port.', 'info')
          return
        }
        if (hit) {
          const lib = useLibraryStore.getState()
          const devPart = lib.parts.find((p) => p.id === hit.partId)
          if (devPart && isDevice(devPart)) {
            const tpl = lib.templates.find((t) => t.id === templateId)
            const defaultName = tpl?.name ?? `Port ${devPart.ports.length + 1}`
            const sharing = instances.filter((i) => i.partId === devPart.id).length
            const portName = await promptDialog({
              title: `Add port to "${devPart.name}"`,
              message: `This changes the library part, so every ${devPart.name} gets the port${
                sharing > 1 ? ` (${sharing} placed in this project)` : ''
              }, including in other projects. Library edits can't be undone.`,
              label: 'Port name',
              defaultValue: defaultName,
              confirmLabel: 'Add port'
            })
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
    [parts, instances, screenToFlowPosition, addInstance, select, getNodes]
  )

  const onEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, ed: Edge) => {
      const hid = ed.data?.harnessId as string
      const h = harnesses.find((x) => x.id === hid)
      if (h && hid) {
        setHoverHarness(
          hid,
          h.endpoints.map((ep) => ({
            instanceId: ep.deviceInstanceId,
            portId: ep.portId
          }))
        )
      }
    },
    [harnesses, setHoverHarness]
  )

  const runAutoLayout = useCallback(() => {
    const positions = autoLayout(instances, harnesses)
    updatePositions(Object.entries(positions).map(([id, position]) => ({ id, position })))
    setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50)
  }, [instances, harnesses, updatePositions, fitView])

  // Fit the view when asked (e.g. right after a project is opened).
  useEffect(() => {
    if (fitViewRequest === 0) return
    const t = setTimeout(() => fitView({ padding: 0.3, duration: 200 }), 60)
    return () => clearTimeout(t)
  }, [fitViewRequest, fitView])

  // Alignment helpers: operate on all multi-selected instances + primary selection.
  const selectedInstanceIds = useMemo(() => {
    const ids = new Set(multiSelectedIds)
    if (selection?.type === 'instance') ids.add(selection.id)
    return [...ids]
  }, [selection, multiSelectedIds])

  const hasMultiSelect = selectedInstanceIds.length >= 2

  const alignInstances = useCallback(
    (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
      const st = useProjectStore.getState()
      const selInsts = (
        selectedInstanceIds
          .map((id) => st.project.deviceInstances.find((i) => i.id === id))
          .filter((i) => i != null) as DeviceInstance[]
      )
      if (selInsts.length < 2) return
      let target: number
      switch (direction) {
        case 'left':
          target = Math.min(...selInsts.map((i) => i.position.x))
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: target, y: i.position.y } }))
          )
          break
        case 'center': {
          const avg = selInsts.reduce((s, i) => s + i.position.x, 0) / selInsts.length
          target = Math.round(avg)
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: target, y: i.position.y } }))
          )
          break
        }
        case 'right':
          target = Math.max(...selInsts.map((i) => i.position.x))
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: target, y: i.position.y } }))
          )
          break
        case 'top':
          target = Math.min(...selInsts.map((i) => i.position.y))
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: i.position.x, y: target } }))
          )
          break
        case 'middle': {
          const avg = selInsts.reduce((s, i) => s + i.position.y, 0) / selInsts.length
          target = Math.round(avg)
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: i.position.x, y: target } }))
          )
          break
        }
        case 'bottom':
          target = Math.max(...selInsts.map((i) => i.position.y))
          st.updateInstancePositions(
            selInsts.map((i) => ({ id: i.id, position: { x: i.position.x, y: target } }))
          )
          break
      }
    },
    [selectedInstanceIds]
  )

  // Alt+drag duplicate: on drag stop, create a duplicate at the original
  // position and let the dragged node keep its new position.
  const altDragSource = useRef<{ id: string; partId: string; x: number; y: number; label: string } | null>(null)

  const onNodeDragStart = useCallback(
    (e: MouseEvent | TouchEvent, node: Node) => {
      isDragging.current = true
      if (e instanceof MouseEvent && e.altKey) {
        const inst = instances.find((i) => i.id === node.id)
        if (inst) {
          altDragSource.current = {
            id: inst.id,
            partId: inst.partId,
            x: inst.position.x,
            y: inst.position.y,
            label: inst.label
          }
        }
      } else {
        altDragSource.current = null
      }
    },
    [instances]
  )

  const onNodeDragStop = useCallback(
    () => {
      isDragging.current = false
      if (!altDragSource.current) return
      const src = altDragSource.current
      altDragSource.current = null
      const count = instances.filter((i) => i.partId === src.partId).length
      const part = parts.find((p) => p.id === src.partId)
      const label = part ? `${part.name} ${count}` : `${src.label} copy`
      addInstance(src.partId, { x: src.x, y: src.y }, label)
    },
    [instances, parts, addInstance]
  )

  // Arrow-key nudge for the selected devices; coalesced so holding a key
  // makes one undo step, not dozens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (topOverlay() || isTextTarget(e.target) || e.defaultPrevented) return
      const ui = useUiStore.getState()
      const ids = new Set(ui.multiSelectedIds)
      if (ui.selection?.type === 'instance') ids.add(ui.selection.id)
      if (ids.size === 0) return
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (!d) return
      e.preventDefault()
      const st = useProjectStore.getState()
      const moves = st.project.deviceInstances
        .filter((i) => ids.has(i.id))
        .map((i) => ({ id: i.id, position: { x: i.position.x + d[0], y: i.position.y + d[1] } }))
      coalesceUndo(() => st.updateInstancePositions(moves))
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
      const part = inst ? lib.parts[inst.partId] : undefined
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
          onClick: async () => {
            if (!inst) return
            const label = await promptDialog({
              title: 'Rename device',
              label: 'Instance label',
              defaultValue: inst.label,
              confirmLabel: 'Rename'
            })
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
          label: 'Delete device',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => {
            select(null)
            removeInstance(menu.id)
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
    select,
    lib
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
        onNodeClick={(e, n) => {
          if (e.ctrlKey || e.metaKey) {
            toggleMultiSelect(n.id)
            if (!multiSelectedIds.includes(n.id)) select({ type: 'instance', id: n.id })
          } else {
            select({ type: 'instance', id: n.id })
          }
        }}
        onEdgeClick={(_, ed) => {
          const hid = ed.data?.harnessId as string
          if (hid) select({ type: 'harness', id: hid })
        }}
        onEdgeDoubleClick={(_, ed) => {
          const hid = ed.data?.harnessId as string
          if (hid) openHarnessEditor(hid)
        }}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={() => setHoverHarness(null)}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => { select(null); useUiStore.getState().clearMultiSelect() }}
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
          const hid = ed.data?.harnessId as string
          if (hid) { select({ type: 'harness', id: hid }); setMenu({ x: e.clientX, y: e.clientY, kind: 'edge', id: hid }) }
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onConnectStart={(_, { nodeId, handleId }) => {
          if (nodeId && handleId) setConnectSource({ instanceId: nodeId, portId: handleId })
        }}
        onConnectEnd={() => setConnectSource(null)}
        connectionLineStyle={{ stroke: 'var(--color-accent)', strokeWidth: 2, strokeDasharray: '5 4', opacity: 0.8 }}
        connectionRadius={50}
        fitView
        // This canvas stays mounted under full-screen overlays (Harness
        // Editor, Library Manager); never let Delete reach it from there.
        deleteKeyCode={overlayOpen ? null : ['Backspace', 'Delete']}
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="var(--color-edge)"
        />
        <MiniMap
          ariaLabel="Overview map"
          pannable
          zoomable
          nodeColor="var(--color-edge)"
          maskColor="var(--color-mask)"
          style={{ background: 'var(--color-panel)' }}
        />
        <Controls />
      </ReactFlow>

      <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-2">
        {hasMultiSelect && (
          <>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('left')} title="Align left">
              <AlignStartHorizontal size={15} />
            </button>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('center')} title="Align center (horizontal)">
              <AlignCenterHorizontal size={15} />
            </button>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('right')} title="Align right">
              <AlignEndHorizontal size={15} />
            </button>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('top')} title="Align top">
              <AlignStartVertical size={15} />
            </button>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('middle')} title="Align middle (vertical)">
              <AlignCenterVertical size={15} />
            </button>
            <button className="ww-btn pointer-events-auto" onClick={() => alignInstances('bottom')} title="Align bottom">
              <AlignEndVertical size={15} />
            </button>
            <span className="pointer-events-none text-muted text-[11px] self-center px-1">|</span>
          </>
        )}
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
