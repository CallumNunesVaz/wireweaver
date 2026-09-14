import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessEndpoint,
  PartBase,
  SubassemblyPart
} from './types'
import { endLabel, isDevice } from './types'
import type { LibraryLike } from './derivation'

export function createSubassembly(
  harness: Harness,
  name: string,
  base: Omit<PartBase, 'kind' | 'id'>
): SubassemblyPart {
  return {
    ...base,
    id: nanoid(),
    kind: 'subassembly',
    name,
    harness: { ...harness },
    exposedPorts: []
  }
}

export function instantiateSubassembly(
  subassembly: SubassemblyPart,
  position: { x: number; y: number }
): { instances: DeviceInstance[]; newHarness: Harness } {
  const instances: DeviceInstance[] = []
  const endpoints: HarnessEndpoint[] = []
  const subId = nanoid()

  const numPorts = subassembly.exposedPorts.length
  if (numPorts === 0) {
    const inst: DeviceInstance = {
      id: subId,
      partId: subassembly.id,
      label: subassembly.name,
      position
    }
    instances.push(inst)
    return { instances, newHarness: { ...subassembly.harness, endpoints: [], wires: [], splices: [], accessories: [] } }
  }

  const inst: DeviceInstance = {
    id: subId,
    partId: subassembly.id,
    label: subassembly.name,
    position
  }
  instances.push(inst)

  for (const port of subassembly.exposedPorts) {
    endpoints.push({
      deviceInstanceId: subId,
      portId: port.id
    })
  }

  const wireIdMap = new Map<string, string>()
  for (const w of subassembly.harness.wires) {
    wireIdMap.set(w.id, nanoid())
  }

  const remappedWires = subassembly.harness.wires.map((w) => ({
    ...w,
    id: wireIdMap.get(w.id)!,
    twistedWith: w.twistedWith ? wireIdMap.get(w.twistedWith) ?? w.twistedWith : undefined
  }))

  const remappedSplices = (subassembly.harness.splices ?? []).map((s) => ({
    ...s,
    id: nanoid(),
    wireIds: s.wireIds.map((wid) => wireIdMap.get(wid) ?? wid)
  }))

  const newHarness: Harness = {
    ...subassembly.harness,
    id: nanoid(),
    name: `${subassembly.name} Harness`,
    endpoints,
    wires: remappedWires,
    accessories: (subassembly.harness.accessories ?? []).map((a) => ({ ...a, id: nanoid() })),
    splices: remappedSplices
  }

  return { instances, newHarness }
}

export interface SubassemblyInstantiation {
  harness: Harness | null
  matched: number
  missing: number
}

/**
 * Re-create a subassembly's saved harness in the current project. Endpoints are
 * matched to existing device instances by port id (preferring an unused
 * instance), so a reusable harness can be dropped into any project that has the
 * same device parts placed. Unmatched endpoints and their wires are dropped.
 */
export function instantiateSubassemblyHarness(
  lib: LibraryLike,
  instances: DeviceInstance[],
  sub: SubassemblyPart
): SubassemblyInstantiation {
  const src = sub.harness
  const endpoints: HarnessEndpoint[] = []
  const remap = new Map<string, string>()
  const used = new Set<string>()
  let missing = 0

  src.endpoints.forEach((ep, i) => {
    const oldLabel = endLabel(i)
    const match = instances.find((inst) => {
      const p = lib.parts[inst.partId]
      if (!p || !isDevice(p) || !p.ports.some((port) => port.id === ep.portId)) return false
      return !used.has(`${inst.id}:${ep.portId}`)
    })
    if (match) {
      used.add(`${match.id}:${ep.portId}`)
      remap.set(oldLabel, endLabel(endpoints.length))
      endpoints.push({ deviceInstanceId: match.id, portId: ep.portId })
    } else {
      missing++
    }
  })

  if (endpoints.length < 2) return { harness: null, matched: 0, missing }

  const wires = src.wires
    .filter((w) => remap.has(w.from.end) && remap.has(w.to.end))
    .map((w) => ({
      ...w,
      id: nanoid(),
      from: { ...w.from, end: remap.get(w.from.end)! },
      to: { ...w.to, end: remap.get(w.to.end)! },
      twistedWith: undefined
    }))
  const segments = src.segments
    .filter((s) => remap.has(s.fromEnd) && remap.has(s.toEnd))
    .map((s) => ({
      ...s,
      fromEnd: remap.get(s.fromEnd)!,
      toEnd: remap.get(s.toEnd)!
    }))

  const harness: Harness = {
    id: nanoid(),
    name: sub.name,
    endpoints,
    wires,
    segments,
    accessories: (src.accessories ?? []).map((a) => ({ ...a, id: nanoid() })),
    splices: []
  }
  return { harness, matched: endpoints.length, missing }
}
