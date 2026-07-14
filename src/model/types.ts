// ---------- Shared part properties ----------
export type PartType = 'COTS' | 'MOTS' | 'Custom'
export type PartKind = 'device' | 'connector' | 'wire'

export interface Money {
  amount: number
  currency: string // ISO 4217, e.g. 'USD', 'AUD'
}

export interface PartBase {
  id: string
  kind: PartKind
  name: string
  imageHash?: string
  type: PartType
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  manufacturerPartUrl?: string
  supplier: string
  supplierPartNumber: string
  supplierPartUrl?: string
  cost?: Money
  weightGrams?: number
  notes?: string
}

// ---------- The three part kinds ----------
export type PortSide = 'left' | 'right' | 'top' | 'bottom'

export interface DevicePort {
  id: string
  name: string
  pinoutTemplateId: string
  side: PortSide
}

export interface DevicePart extends PartBase {
  kind: 'device'
  ports: DevicePort[]
}

export type ConnectorGender = 'male' | 'female' | 'hermaphroditic'

export interface ConnectorPart extends PartBase {
  kind: 'connector'
  positions: number
  gender?: ConnectorGender
}

export interface WirePart extends PartBase {
  kind: 'wire'
  gauge?: string
  color?: string
  conductors?: number
}

export type Part = DevicePart | ConnectorPart | WirePart

// ---------- Pinout templates (logical, not physical) ----------
export type SignalClass = 'power' | 'ground' | 'data' | 'shield' | 'nc'

export interface PinDef {
  position: number // 1-based
  signal: string
  signalClass?: SignalClass
}

export interface PinoutTemplate {
  id: string
  name: string
  connectorPartId: string
  pins: PinDef[]
}

// ---------- Project (assembly) ----------
export interface DeviceInstance {
  id: string
  partId: string
  label: string
  position: { x: number; y: number }
}

export interface HarnessEndpoint {
  deviceInstanceId: string
  portId: string
}

export interface HarnessWire {
  id: string
  from: { end: 'a' | 'b'; position: number }
  to: { end: 'a' | 'b'; position: number }
  wirePartId?: string
  color?: string
}

export interface Harness {
  id: string
  name: string
  a: HarnessEndpoint
  b: HarnessEndpoint
  wires: HarnessWire[]
  lengthMm?: number
}

export interface Project {
  id: string
  name: string
  deviceInstances: DeviceInstance[]
  harnesses: Harness[]
  partSnapshots: Record<string, Part>
  templateSnapshots: Record<string, PinoutTemplate>
}

// ---------- Type guards ----------
export const isDevice = (p: Part): p is DevicePart => p.kind === 'device'
export const isConnector = (p: Part): p is ConnectorPart => p.kind === 'connector'
export const isWire = (p: Part): p is WirePart => p.kind === 'wire'
