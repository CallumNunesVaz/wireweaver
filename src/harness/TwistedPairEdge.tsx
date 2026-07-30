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
 * around the bezier centreline shared with its mate (passed via edge data),
 * with opposite phases — together the two edges read as one helix following
 * the same S-curve as regular edges.
 */

type TwistData = {
  mateSourceHandle?: string
  mateTargetHandle?: string
  phase?: number
  stripePrimary?: string
  stripeSecondary?: string
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

/** Direction vector for a Position enum. */
function directionVector(pos: string): { x: number; y: number } {
  switch (pos) {
    case 'left': return { x: -1, y: 0 }
    case 'right': return { x: 1, y: 0 }
    case 'top': return { x: 0, y: -1 }
    case 'bottom': return { x: 0, y: 1 }
    default: return { x: 1, y: 0 }
  }
}

/** Evaluate a cubic bezier at parameter t (0..1). */
function bezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { x: number; y: number } {
  const mt = 1 - t
  const mt2 = mt * mt
  const mt3 = mt2 * mt
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  }
}

/** Evaluate cubic bezier derivative (tangent) at parameter t (0..1). */
function bezierTangent(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { x: number; y: number } {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y)
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
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    opacity: style?.opacity,
    filter: style?.filter,
    fill: 'none'
  }

  // Mate unknown — plain bezier fallback.
  if (!mateS || !mateT) {
    const [path] = getBezierPath({
      sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition
    })
    if (d.stripePrimary && d.stripeSecondary) {
      return (
        <>
          <BaseEdge path={path} style={{ ...edgeStyle, stroke: d.stripePrimary, strokeDasharray: undefined }} />
          <BaseEdge path={path} style={{ ...edgeStyle, stroke: d.stripeSecondary, strokeDasharray: '8 8' }} />
        </>
      )
    }
    return <BaseEdge path={path} style={edgeStyle} />
  }

  // --- Centreline bezier through the midpoint of each pin pair ---
  const cs = { x: (sourceX + mateS.x) / 2, y: (sourceY + mateS.y) / 2 }
  const ct = { x: (targetX + mateT.x) / 2, y: (targetY + mateT.y) / 2 }
  const dist = Math.hypot(ct.x - cs.x, ct.y - cs.y)
  const handleLen = Math.min(180, dist * 0.4 || 50)

  const srcDir = directionVector(sourcePosition)
  const tgtDir = directionVector(targetPosition)
  const cp1 = { x: cs.x + srcDir.x * handleLen, y: cs.y + srcDir.y * handleLen }
  const cp2 = { x: ct.x + tgtDir.x * handleLen, y: ct.y + tgtDir.y * handleLen }

  // Compute normals at each end from the bezier tangent, so d0/d1
  // match the coordinate system used during sampling.
  const tan0 = bezierTangent(0, cs, cp1, cp2, ct)
  const tan0Len = Math.hypot(tan0.x, tan0.y) || 1
  const n0x = -tan0.y / tan0Len
  const n0y = tan0.x / tan0Len

  const tan1 = bezierTangent(1, cs, cp1, cp2, ct)
  const tan1Len = Math.hypot(tan1.x, tan1.y) || 1
  const n1x = -tan1.y / tan1Len
  const n1y = tan1.x / tan1Len

  const d0 = (sourceX - cs.x) * n0x + (sourceY - cs.y) * n0y
  const d1 = (targetX - ct.x) * n1x + (targetY - ct.y) * n1y

  // Approximate arc length of the bezier for wavelength / lead scaling.
  const chordLen = Math.hypot(ct.x - cs.x, ct.y - cs.y) || 1
  const approxArcLen = chordLen + 2 * handleLen * 0.6

  const amp = Math.min(10, Math.max(3.5, (Math.abs(d0) + Math.abs(d1)) / 2 || 6))
  const wavelength = 28
  const lead = Math.min(24, approxArcLen * 0.15)
  const phase = d.phase ?? 0

  // Sample the bezier centerline at fine intervals, offsetting each point
  // perpendicularly to create the helix.
  const steps = Math.max(60, Math.ceil(approxArcLen / 2))
  const sampled: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const pt = bezierPoint(t, cs, cp1, cp2, ct)
    const tan = bezierTangent(t, cs, cp1, cp2, ct)
    const tl = Math.hypot(tan.x, tan.y) || 1
    const normX = -tan.y / tl
    const normY = tan.x / tl

    // Distance along the curve (parameter-space approximation).
    const s = t * approxArcLen
    const r = Math.min(1, s / lead, (approxArcLen - s) / lead)
    const smooth = r * r * (3 - 2 * r)
    const own = d0 + (d1 - d0) * t
    const helix = amp * Math.sin(((s - lead) / wavelength) * 2 * Math.PI + phase)
    const off = own * (1 - smooth) + helix * smooth

    sampled.push({ x: pt.x + normX * off, y: pt.y + normY * off })
  }

  // Convert points to smooth cubic bezier spline (Catmull-Rom → Bezier).
  let path = `M${sampled[0].x},${sampled[0].y}`
  for (let i = 1; i < sampled.length; i++) {
    const p0 = sampled[i - 2] ?? sampled[i - 1]
    const p1 = sampled[i - 1]
    const p2 = sampled[i]
    const p3 = sampled[i + 1] ?? sampled[i]
    path += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`
  }

  if (d.stripePrimary && d.stripeSecondary) {
    return (
      <>
        <BaseEdge path={path} style={{ ...edgeStyle, stroke: d.stripePrimary, strokeDasharray: undefined }} />
        <BaseEdge path={path} style={{ ...edgeStyle, stroke: d.stripeSecondary, strokeDasharray: '8 8' }} />
      </>
    )
  }

  return <BaseEdge path={path} style={edgeStyle} />
}

export const TwistedPairEdge = memo(TwistedPairEdgeImpl)
