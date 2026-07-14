import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Cpu } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { imageUrl } from '../shared/useImage'
import { isDevice, type DevicePort, type PortSide } from '../model/types'

const SIDE_TO_POSITION: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom
}

export type DeviceNodeData = { instanceId: string }

function DeviceNodeImpl({ id, selected }: NodeProps) {
  const instance = useProjectStore((s) =>
    s.project.deviceInstances.find((d) => d.id === id)
  )
  const part = useLibraryStore((s) =>
    instance ? s.parts.find((p) => p.id === instance.partId) : undefined
  )
  // Precomputed at hover time in uiStore: this selector returns a primitive, so
  // only the two endpoint nodes re-render when harness hover changes.
  const hoveredPortId = useUiStore(
    (s) => s.hoverEndpoints.find((e) => e.instanceId === id)?.portId
  )
  const img = imageUrl(part?.imageHash, 'thumb')

  if (!instance) return null
  const device = part && isDevice(part) ? part : undefined
  const ports = device?.ports ?? []

  // Tooltip only — read without subscribing so template edits don't re-render
  // every node on the canvas.
  const portSignals = (port: DevicePort): string => {
    const lib = useLibraryStore.getState()
    const tpl = lib.templates.find((t) => t.id === port.pinoutTemplateId)
    if (!tpl || tpl.pins.length === 0) return port.name
    const connector = tpl.connectorPartId
      ? lib.parts.find((p) => p.id === tpl.connectorPartId)
      : undefined
    const signals = tpl.pins.map((p) => p.signal || '??').join(', ')
    return connector ? `${connector.name}: ${signals}` : signals
  }

  const bySide: Record<PortSide, DevicePort[]> = {
    left: [],
    right: [],
    top: [],
    bottom: []
  }
  for (const p of ports) bySide[p.side].push(p)

  return (
    <div
      className={`relative rounded-lg border bg-panelalt shadow-lg transition-colors ${
        selected ? 'border-accent' : 'border-edge'
      }`}
      style={{ width: 180, minHeight: 84 }}
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
          {img ? (
            <img src={img} className="h-full w-full object-cover" alt="" />
          ) : (
            <Cpu size={16} className="text-muted" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{instance.label}</div>
          <div className="truncate text-[10px] text-muted">
            {device ? device.name : 'missing device part'}
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 text-[10px] text-muted">
        {ports.length} port{ports.length === 1 ? '' : 's'}
      </div>

      {ports.map((port) => {
        const pos = SIDE_TO_POSITION[port.side]
        const list = bySide[port.side]
        const idx = list.indexOf(port)
        const frac = ((idx + 1) / (list.length + 1)) * 100
        const vertical = port.side === 'left' || port.side === 'right'
        const style: React.CSSProperties = vertical
          ? { top: `${frac}%` }
          : { left: `${frac}%` }
        const highlight = hoveredPortId === port.id
        return (
          <div key={port.id}>
            <Handle
              id={port.id}
              type="source"
              position={pos}
              isConnectableStart
              isConnectableEnd
              title={portSignals(port) || port.name}
              style={{
                ...style,
                width: 10,
                height: 10,
                background: highlight ? '#5b9bff' : '#8b8f98',
                border: '2px solid #14161b'
              }}
            />
            <PortLabel side={port.side} frac={frac} name={port.name} highlight={highlight} />
          </div>
        )
      })}
    </div>
  )
}

function PortLabel({
  side,
  frac,
  name,
  highlight
}: {
  side: PortSide
  frac: number
  name: string
  highlight: boolean
}) {
  const base = 'pointer-events-none absolute whitespace-nowrap text-[9px] '
  const color = highlight ? 'text-accent' : 'text-muted'
  const style: React.CSSProperties = {}
  let cls = base + color + ' '
  if (side === 'left') {
    style.top = `${frac}%`
    style.right = '100%'
    style.transform = 'translateY(-50%)'
    cls += 'pr-2 text-right'
  } else if (side === 'right') {
    style.top = `${frac}%`
    style.left = '100%'
    style.transform = 'translateY(-50%)'
    cls += 'pl-2'
  } else if (side === 'top') {
    style.left = `${frac}%`
    style.bottom = '100%'
    style.transform = 'translateX(-50%)'
    cls += 'pb-1'
  } else {
    style.left = `${frac}%`
    style.top = '100%'
    style.transform = 'translateX(-50%)'
    cls += 'pt-1'
  }
  return (
    <span className={cls} style={style}>
      {name}
    </span>
  )
}

export const DeviceNode = memo(DeviceNodeImpl)
