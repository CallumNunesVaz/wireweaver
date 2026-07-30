import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Link2 } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { isWire, type WirePart } from '../model/types'

export type SpliceNodeData = {
  spliceId: string
  name: string
  wirePartId?: string
  onDropWire: (spliceId: string, wirePart: WirePart) => void
}

function SpliceNodeImpl({ data }: NodeProps) {
  const d = data as SpliceNodeData
  const wirePart = d.wirePartId
    ? useLibraryStore((s) => s.parts.find((p) => p.id === d.wirePartId && isWire(p))) as WirePart | undefined
    : undefined

  return (
    <div
      className="relative flex flex-col items-center justify-center rounded border-2 border-accent bg-panelalt p-2 shadow-lg"
      style={{ width: 64, height: 64, transform: 'rotate(45deg)' }}
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
        e.stopPropagation()
        const lib = useLibraryStore.getState()
        const wp = lib.parts.find((p) => isWire(p) && p.id === wpId) as WirePart | undefined
        if (wp) d.onDropWire(d.spliceId, wp)
      }}
    >
      <div style={{ transform: 'rotate(-45deg)' }} className="text-center">
        <Link2 size={14} className="mx-auto text-accent" />
        <div className="text-[9px] font-semibold mt-0.5">{d.name}</div>
        {wirePart && <div className="text-[8px] text-muted truncate max-w-[50px]">{wirePart.name}</div>}
      </div>
      <Handle
        type="source"
        position={Position.Top}
        id={`${d.spliceId}-top`}
        style={{ background: '#5b9bff', width: 10, height: 10, border: '2px solid #14161b' }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id={`${d.spliceId}-bottom`}
        style={{ background: '#5b9bff', width: 10, height: 10, border: '2px solid #14161b' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id={`${d.spliceId}-left`}
        style={{ background: '#5b9bff', width: 10, height: 10, border: '2px solid #14161b' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={`${d.spliceId}-right`}
        style={{ background: '#5b9bff', width: 10, height: 10, border: '2px solid #14161b' }}
      />
    </div>
  )
}

export const SpliceNode = memo(SpliceNodeImpl)
