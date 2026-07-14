import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Twisted pair edge: two intertwined sine-wave lines that cross over each
 * other, visually representing a twisted pair of wires.
 */
function TwistedPairEdgeImpl({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })

  const color = (style?.stroke as string) ?? '#5b9bff'
  const width = (style?.strokeWidth as number) ?? 2
  const offset = 3

  // Build a "twisted" pair: offset the path by +offset and -offset, then
  // intersect them with alternating dash patterns to simulate a helix.
  return (
    <>
      {/* Strand A — offset above */}
      <BaseEdge
        path={path}
        style={{
          stroke: color,
          strokeWidth: width,
          opacity: 0.6,
          transform: `translateY(${-offset}px)`,
          filter: `drop-shadow(0 ${offset}px 0 ${color}44)`
        }}
      />
      {/* Strand B — offset below, dashed to create twist effect */}
      <BaseEdge
        path={path}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: `${offset * 2} ${offset * 2}`,
          opacity: 0.9,
          transform: `translateY(${offset}px)`,
          filter: `drop-shadow(0 ${-offset}px 0 ${color}44)`
        }}
      />
    </>
  )
}

export const TwistedPairEdge = memo(TwistedPairEdgeImpl)
