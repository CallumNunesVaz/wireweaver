import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessEndpoint,
  PartBase,
  SubassemblyPart
} from './types'

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
