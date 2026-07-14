import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PinDef } from '../model/types'
import { signalColor } from '../shared/signal'

export type PinColumnData = {
  end: 'a' | 'b'
  title: string
  connectorName: string
  pins: PinDef[]
  wiredPositions: number[]
}

function PinColumnNodeImpl({ data }: NodeProps) {
  const d = data as PinColumnData
  const side = d.end === 'a' ? Position.Right : Position.Left
  const handleSide = d.end === 'a' ? 'right' : 'left'

  return (
    <div className="w-56 rounded-lg border border-edge bg-panelalt shadow-lg">
      <div className="border-b border-edge px-3 py-2">
        <div className="text-xs font-semibold">{d.title}</div>
        <div className="text-[10px] text-muted">{d.connectorName}</div>
      </div>
      <div className="py-1">
        {d.pins.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-muted">
            No pins (template incomplete).
          </div>
        )}
        {d.pins.map((pin) => {
          const wired = d.wiredPositions.includes(pin.position)
          return (
            <div
              key={pin.position}
              className="relative flex items-center gap-2 px-3 py-1.5"
              style={{
                justifyContent: d.end === 'a' ? 'flex-start' : 'flex-end'
              }}
            >
              {d.end === 'b' && (
                <span className="text-[11px] text-muted">{pin.signal || '—'}</span>
              )}
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-semibold text-white"
                style={{
                  background: signalColor(pin.signalClass),
                  opacity: wired ? 1 : 0.6,
                  boxShadow: wired ? '0 0 0 2px rgba(91,155,255,0.5)' : 'none'
                }}
              >
                {pin.position}
              </span>
              {d.end === 'a' && (
                <span className="text-[11px] text-muted">{pin.signal || '—'}</span>
              )}
              <Handle
                id={`${d.end}:${pin.position}`}
                type="source"
                position={side}
                isConnectableStart
                isConnectableEnd
                style={{
                  [handleSide]: -6,
                  top: '50%',
                  width: 11,
                  height: 11,
                  background: signalColor(pin.signalClass),
                  border: '2px solid #14161b'
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const PinColumnNode = memo(PinColumnNodeImpl)
