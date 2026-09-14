import type {
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  Harness,
  Part,
  PinoutTemplate,
  Project,
  WirePart
} from '../src/model/types'
import type { LibraryLike } from '../src/model/derivation'

export const connector: ConnectorPart = {
  id: 'conn1',
  kind: 'connector',
  name: 'JST GH 4-pos',
  type: 'COTS',
  internalPartNumber: 'IPN-CONN-1',
  manufacturer: 'JST',
  manufacturerPartNumber: 'GHR-04V-S',
  supplier: 'Digi-Key',
  supplierPartNumber: '455-1160-ND',
  positions: 4
}

export const template: PinoutTemplate = {
  id: 'tpl1',
  name: 'CAN + Power',
  connectorPartId: 'conn1',
  pins: [
    { position: 1, signal: '5V', signalClass: 'power' },
    { position: 2, signal: 'CAN_H', signalClass: 'data' },
    { position: 3, signal: 'CAN_L', signalClass: 'data' },
    { position: 4, signal: 'GND', signalClass: 'ground' }
  ]
}

export const device: DevicePart = {
  id: 'dev1',
  kind: 'device',
  name: 'Flight Controller',
  type: 'COTS',
  internalPartNumber: 'IPN-DEV-1',
  manufacturer: 'Acme',
  manufacturerPartNumber: 'FC-X1',
  supplier: 'Acme',
  supplierPartNumber: 'FC-X1',
  ports: [
    { id: 'portA', name: 'CAN A', pinoutTemplateId: 'tpl1', side: 'right' },
    { id: 'portB', name: 'CAN B', pinoutTemplateId: 'tpl1', side: 'left' }
  ]
}

export const wirePart: WirePart = {
  id: 'wire1',
  kind: 'wire',
  name: 'Hookup 22AWG',
  type: 'COTS',
  internalPartNumber: 'IPN-WIRE-1',
  manufacturer: 'Generic',
  manufacturerPartNumber: 'SIL-22-RD',
  supplier: 'Generic',
  supplierPartNumber: '',
  gauge: '22 AWG',
  color: '#ff0000'
}

export const bundlePart: WirePart = {
  id: 'bundle1',
  kind: 'wire',
  name: '4-core shielded',
  type: 'COTS',
  internalPartNumber: 'IPN-WIRE-2',
  manufacturer: 'Alpha',
  manufacturerPartNumber: '1219/4C',
  supplier: 'Digi-Key',
  supplierPartNumber: '',
  gauge: '22 AWG',
  conductors: 4,
  colorCode: 'DIN',
  shield: true,
  category: 'bundle'
}

export const parts: Part[] = [connector, device, wirePart, bundlePart]

export const templates: PinoutTemplate[] = [template]

export const lib: LibraryLike = {
  parts: Object.fromEntries(parts.map((p) => [p.id, p])),
  templates: { tpl1: template }
}

export const instances: DeviceInstance[] = [
  { id: 'i1', partId: 'dev1', label: 'FC #1', position: { x: 0, y: 0 } },
  { id: 'i2', partId: 'dev1', label: 'FC #2', position: { x: 300, y: 0 } },
  { id: 'i3', partId: 'dev1', label: 'FC #3', position: { x: 600, y: 0 } }
]

export const harness: Harness = {
  id: 'h1',
  name: 'FC1-FC2',
  endpoints: [
    { deviceInstanceId: 'i1', portId: 'portA' },
    { deviceInstanceId: 'i2', portId: 'portA' }
  ],
  wires: [
    {
      id: 'w1',
      from: { end: 'a', position: 1 },
      to: { end: 'b', position: 1 },
      wirePartId: 'wire1',
      color: '#ff0000'
    },
    {
      id: 'w2',
      from: { end: 'a', position: 4 },
      to: { end: 'b', position: 4 },
      wirePartId: 'wire1',
      color: '#000000',
      label: 'GND-LINK'
    }
  ],
  segments: [{ fromEnd: 'a', toEnd: 'b', lengthMm: 250 }],
  accessories: [],
  splices: []
}

export const project: Project = {
  id: 'p1',
  name: 'Test Rig',
  deviceInstances: instances,
  harnesses: [harness],
  partSnapshots: {},
  templateSnapshots: {},
  revisions: []
}

/** A fresh deep copy so tests can mutate without leaking. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
