import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps
} from '@xyflow/react'
import { AlertTriangle, CheckCircle2, Circle, Pencil } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import type { HarnessStatus } from '../model/derivation'

export type HarnessEdgeData = {
  harnessId?: string
  name: string
  status: HarnessStatus
  wireCount: number
  hovered: boolean
  showLabel?: boolean
}

const STATUS_COLOR: Record<HarnessStatus, string> = {
  unwired: '#7a808c',
  partial: '#c48a2f',
  wired: '#3fb27f',
  invalid: '#e5484d'
}

function HarnessEdgeImpl({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected
}: EdgeProps) {
  const d = data as HarnessEdgeData
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })
  const status = d?.status ?? 'unwired'
  const color = STATUS_COLOR[status]
  const isHovered = !!(d?.hovered || selected)

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: color,
          strokeWidth: isHovered ? 3 : 2,
          strokeDasharray: status === 'unwired' ? '6 4' : undefined,
          opacity: isHovered ? 1 : 0.85
        }}
      />
      <EdgeLabelRenderer>
        {d?.showLabel !== false && (
          <div
            className="nodrag nopan absolute flex cursor-pointer items-center gap-1 rounded border bg-panel px-1.5 py-0.5 text-[10px]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: selected ? '#5b9bff' : '#2f343f',
              pointerEvents: 'all'
            }}
            onDoubleClick={() => {
              if (d?.harnessId) openHarnessEditor(d.harnessId)
            }}
            title="Double-click to edit harness"
          >
            <StatusIcon status={status} color={color} />
            <span className="max-w-[140px] truncate">{d?.name}</span>
            <span className="text-muted">· {d?.wireCount ?? 0}w</span>
          </div>
        )}

        {isHovered && d?.showLabel !== false && (
          <button
            className="nodrag nopan absolute flex items-center gap-1 rounded border border-accent bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg hover:brightness-110"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 22}px)`,
              pointerEvents: 'all'
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (d?.harnessId) openHarnessEditor(d.harnessId)
            }}
            title="Edit harness wiring"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

const StatusIcon = memo(function StatusIcon({ status, color }: { status: HarnessStatus; color: string }) {
  if (status === 'wired') return <CheckCircle2 size={12} color={color} />
  if (status === 'invalid') return <AlertTriangle size={12} color={color} />
  if (status === 'partial') return <AlertTriangle size={12} color={color} />
  return <Circle size={12} color={color} />
})

export const HarnessEdge = memo(HarnessEdgeImpl, (prev, next) =>
  prev.id === next.id &&
  prev.selected === next.selected &&
  prev.data?.harnessId === next.data?.harnessId &&
  prev.data?.hovered === next.data?.hovered &&
  prev.data?.status === next.data?.status &&
  prev.data?.wireCount === next.data?.wireCount
)
