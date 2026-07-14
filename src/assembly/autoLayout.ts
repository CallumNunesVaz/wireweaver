import dagre from 'dagre'
import type { DeviceInstance, Harness } from '../model/types'

const NODE_W = 180
const NODE_H = 110

/** Compute a left-to-right dagre layout, returning new positions per instance id. */
export function autoLayout(
  instances: DeviceInstance[],
  harnesses: Harness[]
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const inst of instances) g.setNode(inst.id, { width: NODE_W, height: NODE_H })
  for (const h of harnesses) {
    if (
      instances.some((i) => i.id === h.a.deviceInstanceId) &&
      instances.some((i) => i.id === h.b.deviceInstanceId)
    ) {
      g.setEdge(h.a.deviceInstanceId, h.b.deviceInstanceId)
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
