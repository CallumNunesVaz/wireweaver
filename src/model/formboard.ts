import type { Harness, DeviceInstance } from './types'
import { endLabel } from './types'
import type { LibraryLike } from './derivation'
import { resolveAllEndpoints } from './derivation'

export interface FormboardNode {
  x: number
  y: number
  label: string
  connectorName: string
  length: number
}

/**
 * Generate a 1:1-scale formboard layout for printing.
 *
 * Places the first endpoint at (0,0), then walks the segment graph using BFS
 * to place each connected endpoint at the correct distance along an expanding
 * spiral so branches don't overlap. Returns nodes sorted by branch depth.
 *
 * Scale: 1mm = 1px.
 */
export function generateFormboardLayout(
  harness: Harness,
  lib: LibraryLike,
  instances: DeviceInstance[]
): FormboardNode[] {
  const SCALE = 1 // 1mm = 1px
  const SEPARATION = 80 // pixels between sibling branches
  const ANGLE_STEP = Math.PI / 6 // 30° per branch

  const { resolved } = resolveAllEndpoints(
    lib,
    instances,
    harness
  )

  const nodes: FormboardNode[] = []
  const placed = new Map<string, { x: number; y: number; totalLength: number }>()

  const endpoints = harness.endpoints
  if (endpoints.length === 0) return nodes

  const firstLabel = endLabel(0)
  placed.set(firstLabel, { x: 0, y: 0, totalLength: 0 })

  const queue: { label: string; x: number; y: number; totalLength: number; angle: number; depth: number }[] = [
    { label: firstLabel, x: 0, y: 0, totalLength: 0, angle: 0, depth: 0 }
  ]

  // Build adjacency from segments
  const adj = new Map<string, { label: string; lengthMm: number }[]>()
  for (const seg of harness.segments) {
    if (!adj.has(seg.fromEnd)) adj.set(seg.fromEnd, [])
    if (!adj.has(seg.toEnd)) adj.set(seg.toEnd, [])
    adj.get(seg.fromEnd)!.push({ label: seg.toEnd, lengthMm: seg.lengthMm ?? 0 })
    adj.get(seg.toEnd)!.push({ label: seg.fromEnd, lengthMm: seg.lengthMm ?? 0 })
  }

  // Wire-endpoint pairs not joined by a segment get a fallback length.
  const wirePairs = new Set<string>()
  for (const w of harness.wires) {
    if (w.from.end !== w.to.end) {
      wirePairs.add([w.from.end, w.to.end].sort().join('~'))
    }
  }

  const visited = new Set<string>([firstLabel])

  while (queue.length > 0) {
    const current = queue.shift()!
    const neighbors = adj.get(current.label) ?? []

    let branch = 0
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.label)) continue
      visited.add(neighbor.label)

      const dist = neighbor.lengthMm * SCALE
      const angle = current.angle + (branch - (neighbors.length - 1) / 2) * ANGLE_STEP
      const x = current.x + dist * Math.cos(angle)
      const y = current.y + dist * Math.sin(angle) + SEPARATION * branch

      const totalLength = current.totalLength + dist
      placed.set(neighbor.label, { x, y, totalLength })

      queue.push({
        label: neighbor.label,
        x,
        y,
        totalLength,
        angle,
        depth: current.depth + 1
      })

      branch++
    }
  }

  // Handle labels not reached via BFS (wire pairs without segments).
  for (const pair of wirePairs) {
    const [a, b] = pair.split('~')
    if (!placed.has(a) && !placed.has(b)) continue
    if (placed.has(b) && !placed.has(a)) {
      const bp = placed.get(b)!
      placed.set(a, { x: bp.x + SEPARATION, y: bp.y, totalLength: bp.totalLength })
      visited.add(a)
    }
    if (placed.has(a) && !placed.has(b)) {
      const ap = placed.get(a)!
      placed.set(b, { x: ap.x + SEPARATION, y: ap.y, totalLength: ap.totalLength })
      visited.add(b)
    }
  }

  let lastX = 0
  let lastY = 0
  for (const n of nodes) {
    lastX = Math.max(lastX, n.x)
    lastY = Math.max(lastY, n.y)
  }

  for (let i = 0; i < endpoints.length; i++) {
    const label = endLabel(i)
    const pos = placed.get(label)
    if (pos) {
      const re = resolved.get(label)
      nodes.push({
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        label: re?.instance.label ?? label,
        connectorName: re?.connector?.name ?? '(unknown)',
        length: Math.round(pos.totalLength)
      })
      lastX = Math.max(lastX, pos.x)
      lastY = Math.max(lastY, pos.y)
    } else {
      const re = resolved.get(label)
      lastY += SEPARATION
      nodes.push({
        x: Math.round(lastX),
        y: Math.round(lastY),
        label: re?.instance.label ?? label,
        connectorName: re?.connector?.name ?? '(unknown)',
        length: 0
      })
    }
  }

  return nodes
}
