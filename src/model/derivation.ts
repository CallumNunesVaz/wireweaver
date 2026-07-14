import type {
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  DevicePort,
  Harness,
  HarnessEndpoint,
  HarnessWire,
  PinDef,
  PinoutTemplate,
  Part,
  SignalClass
} from './types'
import { isConnector, isDevice, endLabel } from './types'

export interface LibraryLike {
  parts: Record<string, Part>
  templates: Record<string, PinoutTemplate>
}

export interface ResolvedEndpoint {
  instance: DeviceInstance
  device: DevicePart
  port: DevicePort
  template?: PinoutTemplate
  connector?: ConnectorPart
  pins: PinDef[]
}

export function resolvePart(lib: LibraryLike, id: string): Part | undefined {
  return lib.parts[id]
}

export function resolveEndpoint(
  lib: LibraryLike,
  instances: DeviceInstance[],
  ref: { deviceInstanceId: string; portId: string }
): ResolvedEndpoint | undefined {
  const instance = instances.find((i) => i.id === ref.deviceInstanceId)
  if (!instance) return undefined
  const device = lib.parts[instance.partId]
  if (!device || !isDevice(device)) return undefined
  const port = device.ports.find((p) => p.id === ref.portId)
  if (!port) return undefined
  const template = lib.templates[port.pinoutTemplateId]
  const connectorPart = template ? lib.parts[template.connectorPartId] : undefined
  const connector =
    connectorPart && isConnector(connectorPart) ? connectorPart : undefined
  return {
    instance,
    device,
    port,
    template,
    connector,
    pins: template ? [...template.pins].sort((a, b) => a.position - b.position) : []
  }
}

export type HarnessStatus = 'unwired' | 'partial' | 'wired' | 'invalid'

export interface HarnessValidation {
  status: HarnessStatus
  wireCount: number
  maxPins: number
  warnings: string[]
  orphanWireIds: string[]
}

/** Resolve all endpoints of a harness, keyed by their label. */
function resolveAllEndpoints(
  lib: LibraryLike,
  instances: DeviceInstance[],
  harness: Harness
): { resolved: Map<string, ResolvedEndpoint>; missing: string[] } {
  const resolved = new Map<string, ResolvedEndpoint>()
  const missing: string[] = []
  for (let i = 0; i < harness.endpoints.length; i++) {
    const label = String.fromCharCode(97 + i) // 'a', 'b', 'c', ...
    const re = resolveEndpoint(lib, instances, harness.endpoints[i])
    if (re) resolved.set(label, re)
    else missing.push(label)
  }
  return { resolved, missing }
}

export function validateHarness(
  lib: LibraryLike,
  instances: DeviceInstance[],
  harness: Harness
): HarnessValidation {
  const { resolved, missing } = resolveAllEndpoints(lib, instances, harness)
  const warnings: string[] = []
  const orphanWireIds: string[] = []

  if (resolved.size < 2) {
    return {
      status: 'invalid',
      wireCount: 0,
      maxPins: 0,
      warnings: ['Less than 2 endpoints could be resolved.'],
      orphanWireIds: harness.wires.map((w) => w.id)
    }
  }

  if (missing.length > 0) {
    warnings.push(`Unresolved endpoint(s): ${missing.join(', ')}`)
  }

  const pinsFor = (end: string) => resolved.get(end)?.pins ?? []
  const classOf = (end: string, position: number): SignalClass | undefined =>
    pinsFor(end).find((p) => p.position === position)?.signalClass

  for (const w of harness.wires) {
    const fromPins = pinsFor(w.from.end)
    const toPins = pinsFor(w.to.end)
    const fromExists = fromPins.some((p) => p.position === w.from.position)
    const toExists = toPins.some((p) => p.position === w.to.position)
    if (!fromExists || !toExists) {
      orphanWireIds.push(w.id)
      continue
    }
    const fc = classOf(w.from.end, w.from.position)
    const tc = classOf(w.to.end, w.to.position)
    if (fc && tc && fc !== tc && fc !== 'nc' && tc !== 'nc') {
      warnings.push(
        `Signal-class mismatch: ${fc} → ${tc} (pins ${w.from.position}↔${w.to.position}).`
      )
    }
  }

  if (orphanWireIds.length > 0) {
    warnings.push(`${orphanWireIds.length} wire(s) reference pins that no longer exist.`)
  }

  const allPins = [...resolved.values()].map((r) => r.pins.length)
  const maxPins = Math.max(...allPins, 0)
  // Count distinct pin-pair connections: multi-conductor bundles create
  // several strands between the same pins, which is one connection.
  const orphans = new Set(orphanWireIds)
  const seenPairs = new Set<string>()
  for (const w of harness.wires) {
    if (orphans.has(w.id)) continue
    seenPairs.add(
      [`${w.from.end}:${w.from.position}`, `${w.to.end}:${w.to.position}`].sort().join('~')
    )
  }
  const wired = seenPairs.size
  let status: HarnessStatus
  if (orphanWireIds.length > 0) status = 'invalid'
  else if (wired === 0) status = 'unwired'
  else if (maxPins > 0 && wired >= Math.min(...allPins.filter(Boolean))) status = 'wired'
  else status = 'partial'

  return { status, wireCount: wired, maxPins, warnings, orphanWireIds }
}

/** Clear twistedWith references to wires that no longer exist. */
export function sanitizeTwists(wires: HarnessWire[]): HarnessWire[] {
  const ids = new Set(wires.map((w) => w.id))
  return wires.map((w) =>
    w.twistedWith && !ids.has(w.twistedWith) ? { ...w, twistedWith: undefined } : w
  )
}

/**
 * Remove every endpoint belonging to a device instance from a harness.
 * Wire ends address endpoints positionally ('a' = index 0), so surviving
 * wires and segments are remapped to the shifted labels and anything touching
 * a removed endpoint is dropped. Returns null when fewer than two endpoints
 * remain — the harness is no longer meaningful.
 */
export function pruneInstanceFromHarness(
  harness: Harness,
  instanceId: string
): Harness | null {
  if (!harness.endpoints.some((e) => e.deviceInstanceId === instanceId)) return harness
  const remap = new Map<string, string>()
  const endpoints: HarnessEndpoint[] = []
  harness.endpoints.forEach((e, i) => {
    if (e.deviceInstanceId === instanceId) return
    remap.set(endLabel(i), endLabel(endpoints.length))
    endpoints.push(e)
  })
  if (endpoints.length < 2) return null
  const wires = sanitizeTwists(
    harness.wires
      .filter((w) => remap.has(w.from.end) && remap.has(w.to.end))
      .map((w) => ({
        ...w,
        from: { ...w.from, end: remap.get(w.from.end)! },
        to: { ...w.to, end: remap.get(w.to.end)! }
      }))
  )
  const segments = harness.segments
    .filter((s) => remap.has(s.fromEnd) && remap.has(s.toEnd))
    .map((s) => ({ ...s, fromEnd: remap.get(s.fromEnd)!, toEnd: remap.get(s.toEnd)! }))
  return { ...harness, endpoints, wires, segments }
}

/** Suggest a harness name from multiple device instance labels. */
export function suggestHarnessNames(
  instances: DeviceInstance[],
  instanceIds: string[]
): string {
  const labels = instanceIds
    .map((id) => instances.find((i) => i.id === id)?.label ?? '??')
  return labels.join('–')
}
