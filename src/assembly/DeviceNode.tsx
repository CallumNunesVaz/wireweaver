import { memo, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Cpu } from 'lucide-react'
import { useEffectiveLibrary } from '../stores/effectiveLibrary'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { imageUrl } from '../shared/useImage'
import { isDevice, type DevicePort, type PortSide } from '../model/types'

export const DEVICE_NODE_WIDTH = 180
export const DEVICE_NODE_HEIGHT = 110

const SIDE_TO_POSITION: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom
}

const EMPTY_PORTS: DevicePort[] = []

export type DeviceNodeData = {
  instanceId: string
  connectSource?: { instanceId: string; portId: string } | null
}

function DeviceNodeImpl({ id, selected, data }: NodeProps) {
  const nodeData = data as DeviceNodeData
  const instance = useProjectStore((s) =>
    s.project.deviceInstances.find((d) => d.id === id)
  )
  const { lib } = useEffectiveLibrary()
  const part = instance ? lib.parts[instance.partId] : undefined
  const hoveredPortId = useUiStore(
    (s) => s.hoverEndpoints?.find((e) => e.instanceId === id)?.portId
  )
  const img = imageUrl(part?.imageHash, 'thumb')
  const device = part && isDevice(part) ? part : undefined
  const ports = device?.ports ?? EMPTY_PORTS

  // Hooks must run on every render — including the one where this instance
  // has just been removed — so they all sit above the early return below.
  const portSignals = useMemo(() => {
    const map = new Map<string, string>()
    for (const port of ports) {
      const tpl = lib.templates[port.pinoutTemplateId]
      map.set(
        port.id,
        tpl && tpl.pins.length > 0
          ? tpl.pins.map((p) => p.signal || '??').join(', ')
          : port.name
      )
    }
    return map
  }, [ports, lib])

  if (!instance) return null

  const isConnectionTarget =
    nodeData.connectSource != null && nodeData.connectSource.instanceId !== id

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
        {!img && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
            <Cpu size={16} className="text-muted" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{instance.label}</div>
          <div className={`truncate text-[11px] ${device ? 'text-muted' : 'text-danger'}`}>
            {device ? device.name : 'Part missing from library'}
          </div>
        </div>
      </div>

      {img && (
        <div className="flex h-24 items-center justify-center overflow-hidden border-b border-edge bg-edge/40 p-1">
          <img
            src={img}
            className="max-h-full max-w-full object-contain"
            alt=""
            draggable={false}
          />
        </div>
      )}

      <div className="px-2 py-1.5 text-[11px] text-muted">
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
        const connectTarget = isConnectionTarget
        const targetId = `${port.id}-tgt`
        return (
          <div key={port.id}>
            <Handle
              id={port.id}
              type="source"
              position={pos}
              isConnectableStart
              title={`${port.name}: ${portSignals.get(port.id) || 'no pinout'}`}
              aria-label={`Port ${port.name}`}
              style={{
                ...style,
                width: connectTarget ? 12 : 10,
                height: connectTarget ? 12 : 10,
                background: highlight
                  ? 'var(--color-accent)'
                  : connectTarget
                    ? 'rgb(var(--rgb-accent) / 0.5)'
                    : 'var(--color-neutral)',
                border: connectTarget
                  ? '2px solid var(--color-accent)'
                  : '2px solid var(--color-handle-ring)',
                boxShadow: connectTarget ? '0 0 6px rgb(var(--rgb-accent) / 0.5)' : 'none'
              }}
            />
            <Handle
              id={targetId}
              type="target"
              position={pos}
              isConnectableEnd
              style={{
                ...style,
                width: connectTarget ? 18 : 14,
                height: connectTarget ? 18 : 14,
                background: 'transparent',
                border: connectTarget
                  ? '2px dashed rgb(var(--rgb-accent) / 0.5)'
                  : '2px solid transparent',
                borderRadius: '50%',
                zIndex: -1
              }}
            />
            <PortLabel side={port.side} frac={frac} name={port.name} highlight={highlight || connectTarget} />
          </div>
        )
      })}
    </div>
  )
}

const PortLabel = memo(function PortLabel({
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
  const base = 'pointer-events-none absolute whitespace-nowrap text-[11px] '
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
})

export const DeviceNode = memo(DeviceNodeImpl, (prev, next) =>
  prev.id === next.id &&
  prev.selected === next.selected &&
  (prev.data as DeviceNodeData)?.connectSource === (next.data as DeviceNodeData)?.connectSource
)
