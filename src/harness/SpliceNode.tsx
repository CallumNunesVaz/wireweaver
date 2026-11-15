import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Link2 } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { isWire, type WirePart } from '../model/types'

export type SpliceNodeData = {
  spliceId: string
  name: string
  wirePartId?: string
  wireCount: number
  onDropWire: (spliceId: string, wirePart: WirePart) => void
  onHover: (spliceId: string | null) => void
}

/**
 * A splice joins several wires at one point. It is drawn as a free-floating
 * marker; hovering it highlights the wires it joins (wires are edges and
 * React Flow cannot attach edges to edges, so membership is shown by
 * highlighting rather than by drawing connectors).
 */
function SpliceNodeImpl({ data }: NodeProps) {
  const d = data as SpliceNodeData
  // Always call the hook; the selector returns undefined when unassigned.
  const wirePart = useLibraryStore((s) =>
    d.wirePartId ? s.parts.find((p) => p.id === d.wirePartId && isWire(p)) : undefined
  ) as WirePart | undefined

  return (
    <div
      className="relative flex items-center justify-center rounded border-2 border-accent bg-panelalt shadow-lg"
      style={{ width: 64, height: 64, transform: 'rotate(45deg)' }}
      title={`${d.name} · joins ${d.wireCount} wires${wirePart ? ` · ${wirePart.name}` : ''}\nDrop a wire part here to assign it`}
      onMouseEnter={() => d.onHover(d.spliceId)}
      onMouseLeave={() => d.onHover(null)}
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
        <div className="mt-0.5 text-[11px] font-semibold leading-tight">{d.name}</div>
        <div className="text-[11px] leading-tight text-muted">{d.wireCount}w</div>
      </div>
    </div>
  )
}

export const SpliceNode = memo(SpliceNodeImpl)
