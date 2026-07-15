import { memo } from 'react'
import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode
} from '@xyflow/react'

/**
 * Twisted-pair strand: each wire of a mutual pair renders as a sine wave
 * around the centerline shared with its mate (passed via edge data), with
 * opposite phases — together the two edges read as one helix. Short leads at
 * both ends keep the strand anchored to its actual pins.
 */

type TwistData = {
  mateSourceHandle?: string
  mateTargetHandle?: string
  phase?: number
}

function handlePoint(
  node: InternalNode | undefined,
  handleId: string
): { x: number; y: number } | null {
  if (!node) return null
  const hb = node.internals.handleBounds
  const h = [...(hb?.source ?? []), ...(hb?.target ?? [])].find((x) => x.id === handleId)
  if (!h) return null
  return {
    x: node.internals.positionAbsolute.x + h.x + h.width / 2,
    y: node.internals.positionAbsolute.y + h.y + h.height / 2
  }
}

function TwistedPairEdgeImpl({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data
}: EdgeProps) {
  const srcNode = useInternalNode(source)
  const tgtNode = useInternalNode(target)
  const d = (data ?? {}) as TwistData
  const mateS = d.mateSourceHandle ? handlePoint(srcNode, d.mateSourceHandle) : null
  const mateT = d.mateTargetHandle ? handlePoint(tgtNode, d.mateTargetHandle) : null

  const edgeStyle = {
    stroke: (style?.stroke as string) ?? '#5b9bff',
    strokeWidth: (style?.strokeWidth as number) ?? 2,
    strokeDasharray: style?.strokeDasharray,
    opacity: style?.opacity,
    fill: 'none'
  }

  // Mate unknown (stale reference, first render) — plain curve fallback.
  if (!mateS || !mateT) {
    const [path] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition
    })
    return <BaseEdge path={path} style={edgeStyle} />
  }

  // Centerline shared by both strands of the pair.
  const cs = { x: (sourceX + mateS.x) / 2, y: (sourceY + mateS.y) / 2 }
  const ct = { x: (targetX + mateT.x) / 2, y: (targetY + mateT.y) / 2 }
  const dx = ct.x - cs.x
  const dy = ct.y - cs.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux

  // Own perpendicular offset from the centerline at each end; the helix
  // amplitude matches it so strands sweep through each other's positions.
  const d0 = (sourceX - cs.x) * nx + (sourceY - cs.y) * ny
  const d1 = (targetX - ct.x) * nx + (targetY - ct.y) * ny
  const amp = Math.min(10, Math.max(3.5, (Math.abs(d0) + Math.abs(d1)) / 2 || 6))
  const wavelength = 28
  const lead = Math.min(24, len * 0.15)
  const phase = d.phase ?? 0

  const pts: string[] = [`${sourceX},${sourceY}`]
  for (let s = 4; s < len; s += 4) {
    const t = s / len
    // Blend from the pin offset into the helix and back out (smoothstep).
    const r = Math.min(1, s / lead, (len - s) / lead)
    const smooth = r * r * (3 - 2 * r)
    const own = d0 + (d1 - d0) * t
    const helix = amp * Math.sin(((s - lead) / wavelength) * 2 * Math.PI + phase)
    const off = own * (1 - smooth) + helix * smooth
    pts.push(`${cs.x + ux * s + nx * off},${cs.y + uy * s + ny * off}`)
  }
  pts.push(`${targetX},${targetY}`)

  return <BaseEdge path={'M' + pts.join(' L')} style={edgeStyle} />
}

export const TwistedPairEdge = memo(TwistedPairEdgeImpl)
