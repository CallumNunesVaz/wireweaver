import { memo } from 'react'
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps
} from '@xyflow/react'

export type StripedWireData = {
  primary: string
  secondary: string
}

function StripedWireEdgeImpl({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  style
}: EdgeProps) {
  const d = data as StripedWireData | undefined
  const primary = d?.primary ?? '#5b9bff'
  const secondary = d?.secondary ?? '#c48a2f'
  const glow = selected && style?.filter ? { filter: String(style.filter) } : {}

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: primary,
          strokeWidth: selected ? 3 : 2,
          opacity: selected ? 1 : 0.85,
          ...glow
        }}
      />
      <BaseEdge
        path={path}
        style={{
          stroke: secondary,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: '8 8',
          opacity: selected ? 0.9 : 0.75,
          ...glow
        }}
      />
    </>
  )
}

export const StripedWireEdge = memo(StripedWireEdgeImpl)
