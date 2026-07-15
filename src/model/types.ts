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
  createdAt?: number
  updatedAt?: number
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
  colorCode?: ColorCode
  shield?: boolean
  category?: WireCategory
  ulStyle?: string
  jacketMaterial?: string
  voltageRating?: string
  outerDiameterMm?: number
  operatingTemperature?: string
  insulatorColor?: string
  cableStyle?: string
}

export type Part = DevicePart | ConnectorPart | WirePart

// ---------- Wire part extras ----------
export type ColorCode = 'DIN' | 'IEC' | 'TEL' | 'T568A' | 'T568B'
export type WireCategory = 'cable' | 'bundle'

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

/** Endpoint labels are lowercase letters: 'a', 'b', 'c', ... mapped from indices. */
export type EndLabel = string

export function endIndex(label: EndLabel): number {
  return label.charCodeAt(0) - 97
}

export function endLabel(index: number): EndLabel {
  return String.fromCharCode(97 + index)
}

export interface HarnessWire {
  id: string
  from: { end: EndLabel; position: number }
  to: { end: EndLabel; position: number }
  wirePartId?: string
  color?: string
  twistedWith?: string
  /** User label; reports fall back to auto-numbering (W1, W2, …) per harness. */
  label?: string
}

export interface HarnessSegment {
  fromEnd: EndLabel
  toEnd: EndLabel
  lengthMm?: number
  label?: string
}

export interface Harness {
  id: string
  name: string
  endpoints: HarnessEndpoint[]
  wires: HarnessWire[]
  segments: HarnessSegment[]
  /** Editor canvas positions per endpoint label; grid-derived when absent. */
  layout?: Record<EndLabel, { x: number; y: number }>
  description?: string
  notes?: string
}

export interface Project {
  id: string
  name: string
  deviceInstances: DeviceInstance[]
  harnesses: Harness[]
  partSnapshots: Record<string, Part>
  templateSnapshots: Record<string, PinoutTemplate>
  // Title-block metadata for exported documentation.
  revision?: string
  author?: string
  description?: string
}

// ---------- Type guards ----------
export const isDevice = (p: Part): p is DevicePart => p.kind === 'device'
export const isConnector = (p: Part): p is ConnectorPart => p.kind === 'connector'
export const isWire = (p: Part): p is WirePart => p.kind === 'wire'
