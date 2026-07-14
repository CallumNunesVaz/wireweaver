import type {
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  DevicePort,
  Harness,
  PinDef,
  PinoutTemplate,
  Part,
  SignalClass
} from './types'
import { isConnector, isDevice } from './types'

export interface LibraryLike {
  parts: Record<string, Part>
  templates: Record<string, PinoutTemplate>
}

/**
 * A resolved view of one harness endpoint: which device instance / port,
 * its pinout template, and the connector part the harness must mate with.
 * Everything here is *derived* — a harness never stores connectors/pinouts.
 */
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

/**
 * Validate a harness against the current library: count wired pins, flag wires
 * whose pin positions no longer exist (orphans), and warn on signal-class
 * mismatches (e.g. power wired to data).
 */
export function validateHarness(
  lib: LibraryLike,
  instances: DeviceInstance[],
  harness: Harness
): HarnessValidation {
  const a = resolveEndpoint(lib, instances, harness.a)
  const b = resolveEndpoint(lib, instances, harness.b)
  const warnings: string[] = []
  const orphanWireIds: string[] = []

  if (!a || !b) {
    return {
      status: 'invalid',
      wireCount: 0,
      maxPins: 0,
      warnings: ['One or both endpoints could not be resolved.'],
      orphanWireIds: harness.wires.map((w) => w.id)
    }
  }

  const pinsFor = (end: 'a' | 'b') => (end === 'a' ? a.pins : b.pins)
  const classOf = (end: 'a' | 'b', position: number): SignalClass | undefined =>
    pinsFor(end).find((p) => p.position === position)?.signalClass

  for (const w of harness.wires) {
    const fromExists = pinsFor(w.from.end).some((p) => p.position === w.from.position)
    const toExists = pinsFor(w.to.end).some((p) => p.position === w.to.position)
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

  const maxPins = Math.max(a.pins.length, b.pins.length)
  const wired = harness.wires.length - orphanWireIds.length
  let status: HarnessStatus
  if (orphanWireIds.length > 0) status = 'invalid'
  else if (wired === 0) status = 'unwired'
  else if (maxPins > 0 && wired >= Math.min(a.pins.length, b.pins.length))
    status = 'wired'
  else status = 'partial'

  return { status, wireCount: wired, maxPins, warnings, orphanWireIds }
}

/** Suggest a harness name from the two device instance labels. */
export function suggestHarnessName(
  instances: DeviceInstance[],
  aInstanceId: string,
  bInstanceId: string
): string {
  const a = instances.find((i) => i.id === aInstanceId)?.label ?? 'A'
  const b = instances.find((i) => i.id === bInstanceId)?.label ?? 'B'
  return `${a}–${b}`
}
