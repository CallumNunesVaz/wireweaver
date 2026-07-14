import dagre from 'dagre'
import type { DeviceInstance, Harness } from '../model/types'

const NODE_W = 180
// Nodes with an image panel run ~180px tall, plain ones ~84; layout uses one
// uniform height, so size for the tall case to avoid overlaps.
const NODE_H = 180

/** Compute a left-to-right dagre layout, returning new positions per instance id. */
export function autoLayout(
  instances: DeviceInstance[],
  harnesses: Harness[]
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const inst of instances) g.setNode(inst.id, { width: NODE_W, height: NODE_H })
  const known = new Set(instances.map((i) => i.id))
  for (const h of harnesses) {
    // Star from the first endpoint, matching how the canvas draws the edges,
    // so every device on a multi-endpoint harness is pulled into the layout.
    const eps = h.endpoints.filter((e) => known.has(e.deviceInstanceId))
    for (let i = 1; i < eps.length; i++) {
      g.setEdge(eps[0].deviceInstanceId, eps[i].deviceInstanceId)
    }
  }

  dagre.layout(g)

  const out: Record<string, { x: number; y: number }> = {}
  for (const inst of instances) {
    const n = g.node(inst.id)
    if (n) out[inst.id] = { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 }
  }
  return out
}
