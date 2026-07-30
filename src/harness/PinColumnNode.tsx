import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PinDef } from '../model/types'
import { signalColor } from '../shared/signal'

export type PinColumnData = {
  end: string
  title: string
  connectorName: string
  matingConnectorName?: string
  pins: PinDef[]
  wiredPositions: number[]
  hideUnused?: boolean
  pinColors?: (string | undefined)[]
}

function PinColumnNodeImpl({ data }: NodeProps) {
  const d = data as PinColumnData
  const side = d.end === 'a' ? Position.Right : Position.Left
  const handleSide = d.end === 'a' ? 'right' : 'left'

  const visiblePins = d.hideUnused
    ? d.pins.filter((pin) => d.wiredPositions.includes(pin.position))
    : d.pins

  const totalWired = d.wiredPositions.length
  const totalPins = d.pins.length

  return (
    <div className="w-56 rounded border border-edge bg-panelalt">
      <div className="border-b border-edge px-3 py-1.5">
        <div className="text-[11px] font-semibold leading-tight">{d.title}</div>
        <div className="text-[9px] text-muted leading-tight">
          {d.connectorName}
          {d.matingConnectorName && <span> ← {d.matingConnectorName}</span>}
          <span className="ml-1">
            {totalWired}/{totalPins} wired
          </span>
        </div>
      </div>
      <div className="py-0.5">
        {d.pins.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-muted">No pins (template incomplete).</div>
        )}
        {visiblePins.length === 0 && d.pins.length > 0 && (
          <div className="px-3 py-3 text-[11px] text-muted">All pins hidden (toggle "Show unused").</div>
        )}
        {visiblePins.map((pin) => {
          const wired = d.wiredPositions.includes(pin.position)
          return (
            <div
              key={pin.position}
              className="relative flex items-center gap-1.5 px-2 py-0.5"
              style={{ justifyContent: d.end === 'a' ? 'flex-start' : 'flex-end' }}
            >
              {d.end !== 'a' && (
                <span className="text-[10px] text-muted truncate max-w-[72px]">{pin.signal || '—'}</span>
              )}
              <span
                className="flex h-4 min-w-[18px] items-center justify-center rounded-sm px-1 text-[9px] font-semibold text-white"
                style={{
                  background: signalColor(pin.signalClass),
                  opacity: wired ? 1 : 0.45,
                  outline: wired ? '1px solid var(--color-accent)' : 'none',
                  outlineOffset: 1
                }}
              >
                {pin.position}
              </span>
              {d.end === 'a' && (
                <span className="text-[10px] text-muted truncate max-w-[72px]">{pin.signal || '—'}</span>
              )}
              <Handle
                id={`${d.end}:${pin.position}`}
                type="source"
                position={side}
                isConnectableStart
                style={{ [handleSide]: -6, top: '50%', width: 10, height: 10, background: signalColor(pin.signalClass), border: '1px solid #14161b' }}
              />
              <Handle
                id={`${d.end}:${pin.position}-tgt`}
                type="target"
                position={side}
                isConnectableEnd
                style={{ [handleSide]: -8, top: '50%', width: 14, height: 14, background: 'transparent', border: '2px solid transparent', borderRadius: '50%', zIndex: -1 }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const PinColumnNode = memo(PinColumnNodeImpl, (prev, next) => {
  const pd = prev.data as PinColumnData
  const nd = next.data as PinColumnData
  return (
    prev.id === next.id &&
    prev.selected === next.selected &&
    pd.end === nd.end &&
    pd.hideUnused === nd.hideUnused &&
    pd.wiredPositions?.length === nd.wiredPositions?.length &&
    pd.title === nd.title &&
    pd.pins === nd.pins
  )
})
