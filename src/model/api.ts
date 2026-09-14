/**
 * WireWeaver programmatic API.
 *
 * A pure, framework-free layer over the project model for creating and editing
 * harnesses (and everything around them) from code — used by the MCP server and
 * available to any Node/Electron/browser host. No DOM, Electron or fs imports:
 * callers own persistence.
 *
 * Everything mutates the supplied `Workspace` in place and returns the created
 * entity (or the workspace) so calls can be chained.
 */
import { nanoid } from 'nanoid'
import type {
  ConnectorGender,
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  Harness,
  HarnessAccessory,
  HarnessEndpoint,
  HarnessSegment,
  HarnessSplice,
  HarnessWire,
  Part,
  PinDef,
  PinoutTemplate,
  PortSide,
  Project,
  SubassemblyPart,
  WirePart
} from './types'
import { endIndex, endLabel, isDevice, isWire } from './types'
import type { LibraryLike } from './derivation'
import {
  resolveAllEndpoints,
  resolveEndpoint,
  sanitizeTwists
} from './derivation'
import { runDrc, type DrcIssue } from './drc'
import {
  buildBom,
  toCsv as bomCsv,
  type BomRow
} from './bom'
import {
  cutlist as buildCutlist,
  netlist as buildNetlist,
  wiringTableAll,
  type CutlistRow,
  type Net,
  type WiringRow
} from './reports'
import { wirevizYaml } from './wireviz'
import { importWireViz } from './wireviz-import'
import {
  createRevision as makeRevision,
  diffRevisions,
  restoreRevision as restoreRevisionFn
} from './revisions'
import { createSubassembly as makeSubassembly, instantiateSubassemblyHarness } from './subassembly'
import { withSnapshots } from './snapshot'

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface Workspace {
  project: Project
  parts: Part[]
  templates: PinoutTemplate[]
}

export function createWorkspace(name = 'Untitled'): Workspace {
  return {
    project: {
      id: nanoid(),
      name,
      deviceInstances: [],
      harnesses: [],
      partSnapshots: {},
      templateSnapshots: {},
      revisions: []
    },
    parts: [],
    templates: []
  }
}

/** Load a parsed `.wwv` project, seeding the working library from its snapshots. */
export function loadWorkspace(data: Project): Workspace {
  return {
    project: {
      ...data,
      deviceInstances: data.deviceInstances ?? [],
      harnesses: (data.harnesses ?? []).map(normalizeHarness),
      revisions: data.revisions ?? []
    },
    parts: Object.values(data.partSnapshots ?? {}),
    templates: Object.values(data.templateSnapshots ?? {})
  }
}

/** Serialize to the on-disk `.wwv` shape, embedding snapshots for portability. */
export function serializeWorkspace(ws: Workspace): Project {
  return withSnapshots(ws.project, ws.parts, ws.templates)
}

export function libOf(ws: Workspace): LibraryLike {
  const parts: Record<string, Part> = {}
  for (const p of ws.parts) parts[p.id] = p
  const templates: Record<string, PinoutTemplate> = {}
  for (const t of ws.templates) templates[t.id] = t
  return { parts, templates }
}

function normalizeHarness(h: Harness): Harness {
  return {
    ...h,
    endpoints: h.endpoints ?? [],
    wires: h.wires ?? [],
    segments: h.segments ?? [],
    accessories: h.accessories ?? [],
    splices: h.splices ?? []
  }
}

function getHarness(ws: Workspace, harnessId: string): Harness {
  const h = ws.project.harnesses.find((x) => x.id === harnessId)
  if (!h) throw new Error(`Harness "${harnessId}" not found`)
  return h
}

// ---------------------------------------------------------------------------
// Library: parts & templates
// ---------------------------------------------------------------------------

export interface PartInput {
  name: string
  type?: Part['type']
  internalPartNumber?: string
  manufacturer?: string
  manufacturerPartNumber?: string
  manufacturerPartUrl?: string
  supplier?: string
  supplierPartNumber?: string
  supplierPartUrl?: string
  cost?: { amount: number; currency: string }
  weightGrams?: number
  notes?: string
  imageHash?: string
}

function basePart(input: PartInput) {
  return {
    id: nanoid(),
    name: input.name,
    type: input.type ?? 'Custom',
    internalPartNumber: input.internalPartNumber ?? '',
    manufacturer: input.manufacturer ?? '',
    manufacturerPartNumber: input.manufacturerPartNumber ?? '',
    manufacturerPartUrl: input.manufacturerPartUrl,
    supplier: input.supplier ?? '',
    supplierPartNumber: input.supplierPartNumber ?? '',
    supplierPartUrl: input.supplierPartUrl,
    cost: input.cost,
    weightGrams: input.weightGrams,
    notes: input.notes,
    imageHash: input.imageHash,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

export function addPart(ws: Workspace, part: Part): Part {
  const i = ws.parts.findIndex((p) => p.id === part.id)
  if (i >= 0) ws.parts[i] = part
  else ws.parts.push(part)
  return part
}

export function addTemplate(ws: Workspace, template: PinoutTemplate): PinoutTemplate {
  const i = ws.templates.findIndex((t) => t.id === template.id)
  if (i >= 0) ws.templates[i] = template
  else ws.templates.push(template)
  return template
}

export interface ConnectorInput extends PartInput {
  positions: number
  gender?: ConnectorGender
  matingConnectorPartId?: string
  currentRatingAmps?: number
}

export function createConnectorPart(ws: Workspace, input: ConnectorInput): ConnectorPart {
  const part: ConnectorPart = {
    ...basePart(input),
    kind: 'connector',
    positions: input.positions,
    gender: input.gender,
    matingConnectorPartId: input.matingConnectorPartId,
    currentRatingAmps: input.currentRatingAmps
  }
  return addPart(ws, part) as ConnectorPart
}

export interface WirePartInput extends PartInput {
  gauge?: string
  color?: string
  conductors?: number
  colorCode?: WirePart['colorCode']
  shield?: boolean
  category?: WirePart['category']
  ulStyle?: string
  jacketMaterial?: string
  voltageRating?: string
  outerDiameterMm?: number
  operatingTemperature?: string
  insulatorColor?: string
  cableStyle?: string
}

export function createWirePart(ws: Workspace, input: WirePartInput): WirePart {
  const part: WirePart = {
    ...basePart(input),
    kind: 'wire',
    gauge: input.gauge,
    color: input.color,
    conductors: input.conductors ?? 1,
    colorCode: input.colorCode,
    shield: input.shield,
    category: input.category,
    ulStyle: input.ulStyle,
    jacketMaterial: input.jacketMaterial,
    voltageRating: input.voltageRating,
    outerDiameterMm: input.outerDiameterMm,
    operatingTemperature: input.operatingTemperature,
    insulatorColor: input.insulatorColor,
    cableStyle: input.cableStyle
  }
  return addPart(ws, part) as WirePart
}

export interface PortInput {
  name: string
  pinoutTemplateId: string
  side?: PortSide
}

export interface DeviceInput extends PartInput {
  ports?: PortInput[]
}

export function createDevicePart(ws: Workspace, input: DeviceInput): DevicePart {
  const part: DevicePart = {
    ...basePart(input),
    kind: 'device',
    ports: (input.ports ?? []).map((p) => ({
      id: nanoid(),
      name: p.name,
      pinoutTemplateId: p.pinoutTemplateId,
      side: p.side ?? 'right'
    }))
  }
  return addPart(ws, part) as DevicePart
}

export interface TemplateInput {
  name: string
  connectorPartId: string
  pins?: PinDef[]
}

/**
 * Create a pinout template. When `pins` is omitted the pin list is sized from
 * the connector's position count with blank signals.
 */
export function createPinoutTemplate(ws: Workspace, input: TemplateInput): PinoutTemplate {
  let pins = input.pins
  if (!pins) {
    const connector = ws.parts.find((p) => p.id === input.connectorPartId)
    const positions = connector && connector.kind === 'connector' ? connector.positions : 0
    pins = Array.from({ length: positions }, (_, i) => ({
      position: i + 1,
      signal: ''
    }))
  }
  const tpl: PinoutTemplate = {
    id: nanoid(),
    name: input.name,
    connectorPartId: input.connectorPartId,
    pins: [...pins].sort((a, b) => a.position - b.position)
  }
  return addTemplate(ws, tpl)
}

// ---------------------------------------------------------------------------
// Assembly: device instances
// ---------------------------------------------------------------------------

export interface DeviceSpec {
  partId?: string
  partName?: string
  label?: string
  position?: { x: number; y: number }
}

export function addDevice(ws: Workspace, spec: DeviceSpec): DeviceInstance {
  const part = spec.partId
    ? ws.parts.find((p) => p.id === spec.partId)
    : ws.parts.find((p) => p.name === spec.partName)
  if (!part || !isDevice(part)) {
    throw new Error(
      `Device part not found (${spec.partId ?? spec.partName ?? 'no id/name'})`
    )
  }
  const count = ws.project.deviceInstances.filter((i) => i.partId === part.id).length
  const instance: DeviceInstance = {
    id: nanoid(),
    partId: part.id,
    label: spec.label ?? (count > 0 ? `${part.name} ${count + 1}` : part.name),
    position: spec.position ?? { x: 0, y: 0 }
  }
  ws.project.deviceInstances.push(instance)
  return instance
}

export function removeDevice(ws: Workspace, instanceId: string): void {
  ws.project.deviceInstances = ws.project.deviceInstances.filter(
    (i) => i.id !== instanceId
  )
  // Drop harnesses that no longer have at least two endpoints.
  ws.project.harnesses = ws.project.harnesses
    .map((h) => {
      if (!h.endpoints.some((e) => e.deviceInstanceId === instanceId)) return h
      const remap = new Map<string, string>()
      const endpoints: HarnessEndpoint[] = []
      h.endpoints.forEach((e, i) => {
        if (e.deviceInstanceId === instanceId) return
        remap.set(endLabel(i), endLabel(endpoints.length))
        endpoints.push(e)
      })
      if (endpoints.length < 2) return null
      const wires = sanitizeTwists(
        h.wires
          .filter((w) => remap.has(w.from.end) && remap.has(w.to.end))
          .map((w) => ({
            ...w,
            from: { ...w.from, end: remap.get(w.from.end)! },
            to: { ...w.to, end: remap.get(w.to.end)! }
          }))
      )
      const segments = h.segments
        .filter((s) => remap.has(s.fromEnd) && remap.has(s.toEnd))
        .map((s) => ({ ...s, fromEnd: remap.get(s.fromEnd)!, toEnd: remap.get(s.toEnd)! }))
      return { ...h, endpoints, wires, segments }
    })
    .filter((h): h is Harness => h !== null)
}

export function listDevices(ws: Workspace) {
  return ws.project.deviceInstances.map((inst) => {
    const part = ws.parts.find((p) => p.id === inst.partId)
    return {
      id: inst.id,
      label: inst.label,
      partId: inst.partId,
      partName: part?.name ?? '(unknown)',
      position: inst.position,
      ports:
        part && isDevice(part)
          ? part.ports.map((port) => ({
              id: port.id,
              name: port.name,
              pinoutTemplateId: port.pinoutTemplateId,
              connected: ws.project.harnesses.some((h) =>
                h.endpoints.some(
                  (ep) =>
                    ep.deviceInstanceId === inst.id && ep.portId === port.id
                )
              )
            }))
          : []
    }
  })
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/** Address a pin either by harness end label or by device/port identity. */
export type PinRef =
  | { end: string; position: number }
  | { deviceInstanceId: string; portId: string; position: number }
  | { device: string; port?: string; position: number }

export interface WireSpec {
  from: PinRef
  to: PinRef
  wirePartId?: string
  color?: string
  label?: string
  twistedWith?: string
}

export interface SegmentSpec {
  from: string | PinRef
  to: string | PinRef
  lengthMm?: number
  label?: string
}

export interface HarnessSpec {
  name?: string
  endpoints?: HarnessEndpoint[]
  /** Endpoints by device label + port name/id. */
  ports?: { device: string; port: string }[]
  wires?: WireSpec[]
  segments?: SegmentSpec[]
  accessories?: Omit<HarnessAccessory, 'id'>[]
  splices?: { name?: string; wireIds: string[] }[]
}

/** Ensure a harness endpoint exists for the port, returning its end label. */
function ensureEndpoint(h: Harness, deviceInstanceId: string, portId: string): string {
  const existing = h.endpoints.findIndex(
    (e) => e.deviceInstanceId === deviceInstanceId && e.portId === portId
  )
  if (existing >= 0) return endLabel(existing)
  h.endpoints.push({ deviceInstanceId, portId })
  return endLabel(h.endpoints.length - 1)
}

function findInstance(ws: Workspace, label: string): DeviceInstance {
  const inst = ws.project.deviceInstances.find((i) => i.label === label)
  if (!inst) throw new Error(`Device instance "${label}" not found`)
  return inst
}

function portIdByName(ws: Workspace, instance: DeviceInstance, port: string): string {
  const part = ws.parts.find((p) => p.id === instance.partId)
  if (!part || !isDevice(part)) throw new Error(`Instance "${instance.label}" is not a device`)
  const found = part.ports.find((p) => p.id === port || p.name === port)
  if (!found) throw new Error(`Port "${port}" not found on "${instance.label}"`)
  return found.id
}

/** Resolve a PinRef to a harness end label + pin position, adding an endpoint if needed. */
export function resolvePinRef(ws: Workspace, h: Harness, ref: PinRef): { end: string; position: number } {
  if ('end' in ref) return { end: ref.end, position: ref.position }
  if ('deviceInstanceId' in ref) {
    return {
      end: ensureEndpoint(h, ref.deviceInstanceId, ref.portId),
      position: ref.position
    }
  }
  const inst = findInstance(ws, ref.device)
  const portId = ref.port ? portIdByName(ws, inst, ref.port) : undefined
  if (!portId) throw new Error(`A port is required to address "${ref.device}"`)
  return { end: ensureEndpoint(h, inst.id, portId), position: ref.position }
}

export function createHarness(ws: Workspace, spec: HarnessSpec = {}): Harness {
  const endpoints: HarnessEndpoint[] = [...(spec.endpoints ?? [])]
  const h: Harness = {
    id: nanoid(),
    name: spec.name ?? 'Harness',
    endpoints,
    wires: [],
    segments: [],
    accessories: [],
    splices: []
  }
  for (const p of spec.ports ?? []) {
    const inst = findInstance(ws, p.device)
    ensureEndpoint(h, inst.id, portIdByName(ws, inst, p.port))
  }
  if (h.name === 'Harness' && h.endpoints.length >= 1) {
    h.name =
      h.endpoints
        .map((ep) => {
          const inst = ws.project.deviceInstances.find((i) => i.id === ep.deviceInstanceId)
          return inst?.label ?? '?'
        })
        .join('–') || 'Harness'
  }
  ws.project.harnesses.push(h)
  for (const w of spec.wires ?? []) addWire(ws, h.id, w)
  for (const s of spec.segments ?? []) addSegment(ws, h.id, s)
  for (const a of spec.accessories ?? []) addAccessory(ws, h.id, a)
  for (const sp of spec.splices ?? []) addSplice(ws, h.id, sp.wireIds, sp.name)
  return h
}

export function deleteHarness(ws: Workspace, harnessId: string): void {
  ws.project.harnesses = ws.project.harnesses.filter((h) => h.id !== harnessId)
}

export function renameHarness(ws: Workspace, harnessId: string, name: string): Harness {
  const h = getHarness(ws, harnessId)
  h.name = name
  return h
}

export function addEndpoint(
  ws: Workspace,
  harnessId: string,
  endpoint: HarnessEndpoint
): string {
  const h = getHarness(ws, harnessId)
  return ensureEndpoint(h, endpoint.deviceInstanceId, endpoint.portId)
}

export function removeEndpoint(ws: Workspace, harnessId: string, end: string): void {
  const h = getHarness(ws, harnessId)
  const idx = endIndex(end)
  if (idx < 0 || idx >= h.endpoints.length) return
  const remap = new Map<string, string>()
  const endpoints: HarnessEndpoint[] = []
  h.endpoints.forEach((e, i) => {
    if (i === idx) return
    remap.set(endLabel(i), endLabel(endpoints.length))
    endpoints.push(e)
  })
  h.endpoints = endpoints
  h.wires = h.wires
    .filter((w) => remap.has(w.from.end) && remap.has(w.to.end))
    .map((w) => ({
      ...w,
      from: { ...w.from, end: remap.get(w.from.end)! },
      to: { ...w.to, end: remap.get(w.to.end)! }
    }))
  h.segments = h.segments
    .filter((s) => remap.has(s.fromEnd) && remap.has(s.toEnd))
    .map((s) => ({ ...s, fromEnd: remap.get(s.fromEnd)!, toEnd: remap.get(s.toEnd)! }))
}

export function addWire(ws: Workspace, harnessId: string, spec: WireSpec): HarnessWire {
  const h = getHarness(ws, harnessId)
  const from = resolvePinRef(ws, h, spec.from)
  const to = resolvePinRef(ws, h, spec.to)
  const wire: HarnessWire = {
    id: nanoid(),
    from,
    to,
    wirePartId: spec.wirePartId,
    color: spec.color,
    label: spec.label,
    twistedWith: spec.twistedWith
  }
  h.wires.push(wire)
  return wire
}

export function addWires(ws: Workspace, harnessId: string, specs: WireSpec[]): HarnessWire[] {
  return specs.map((s) => addWire(ws, harnessId, s))
}

export function updateWire(
  ws: Workspace,
  harnessId: string,
  wireId: string,
  patch: Partial<Omit<HarnessWire, 'id'>>
): HarnessWire {
  const h = getHarness(ws, harnessId)
  const w = h.wires.find((x) => x.id === wireId)
  if (!w) throw new Error(`Wire "${wireId}" not found`)
  Object.assign(w, patch)
  return w
}

export function removeWire(ws: Workspace, harnessId: string, wireId: string): void {
  const h = getHarness(ws, harnessId)
  h.wires = h.wires.filter((w) => w.id !== wireId)
}

/**
 * Wire adjacent endpoint columns by matching pin signal names. When `allPairs`
 * is true every endpoint pair is considered (star wiring); otherwise only
 * neighbours.
 */
export function autoWire(
  ws: Workspace,
  harnessId: string,
  opts: { allPairs?: boolean; overwrite?: boolean } = {}
): HarnessWire[] {
  const h = getHarness(ws, harnessId)
  const lib = libOf(ws)
  const { resolved } = resolveAllEndpoints(lib, ws.project.deviceInstances, h)
  const norm = (p: PinDef) => p.signal.trim().toLowerCase()
  const used = new Set<string>()
  if (!opts.overwrite) {
    for (const w of h.wires) {
      used.add(`${w.from.end}:${w.from.position}`)
      used.add(`${w.to.end}:${w.to.position}`)
    }
  } else {
    h.wires = []
  }
  const added: HarnessWire[] = []

  const pairs: [number, number][] = []
  for (let i = 0; i < h.endpoints.length; i++) {
    for (let j = i + 1; j < h.endpoints.length; j++) {
      if (opts.allPairs || j === i + 1) pairs.push([i, j])
    }
  }

  for (const [i, j] of pairs) {
    const la = endLabel(i)
    const lb = endLabel(j)
    const ra = resolved.get(la)
    const rb = resolved.get(lb)
    if (!ra || !rb) continue
    for (const pa of ra.pins) {
      const sa = norm(pa)
      if (!sa || pa.signalClass === 'nc') continue
      if (used.has(`${la}:${pa.position}`)) continue
      const match = rb.pins.find(
        (pb) =>
          norm(pb) === sa &&
          pb.signalClass !== 'nc' &&
          !used.has(`${lb}:${pb.position}`)
      )
      if (!match) continue
      const wire: HarnessWire = {
        id: nanoid(),
        from: { end: la, position: pa.position },
        to: { end: lb, position: match.position }
      }
      h.wires.push(wire)
      added.push(wire)
      used.add(`${la}:${pa.position}`)
      used.add(`${lb}:${match.position}`)
    }
  }
  return added
}

export function addSegment(ws: Workspace, harnessId: string, spec: SegmentSpec): HarnessSegment {
  const h = getHarness(ws, harnessId)
  const fromEnd = typeof spec.from === 'string' ? spec.from : resolvePinRef(ws, h, spec.from).end
  const toEnd = typeof spec.to === 'string' ? spec.to : resolvePinRef(ws, h, spec.to).end
  const existing = h.segments.find(
    (s) => s.fromEnd === fromEnd && s.toEnd === toEnd
  )
  if (existing) {
    if (spec.lengthMm != null) existing.lengthMm = spec.lengthMm
    if (spec.label != null) existing.label = spec.label
    return existing
  }
  const seg: HarnessSegment = {
    fromEnd,
    toEnd,
    lengthMm: spec.lengthMm,
    label: spec.label
  }
  h.segments.push(seg)
  return seg
}

export function addAccessory(
  ws: Workspace,
  harnessId: string,
  acc: Omit<HarnessAccessory, 'id'>
): HarnessAccessory {
  const h = getHarness(ws, harnessId)
  const accessory: HarnessAccessory = { ...acc, id: nanoid() }
  h.accessories = [...(h.accessories ?? []), accessory]
  return accessory
}

export function removeAccessory(ws: Workspace, harnessId: string, accId: string): void {
  const h = getHarness(ws, harnessId)
  h.accessories = (h.accessories ?? []).filter((a) => a.id !== accId)
}

export function addSplice(
  ws: Workspace,
  harnessId: string,
  wireIds: string[],
  name?: string
): HarnessSplice {
  const h = getHarness(ws, harnessId)
  const splice: HarnessSplice = {
    id: nanoid(),
    name: name ?? `Splice ${nanoid().slice(0, 6)}`,
    wireIds
  }
  h.splices = [...(h.splices ?? []), splice]
  return splice
}

export function removeSplice(ws: Workspace, harnessId: string, spliceId: string): void {
  const h = getHarness(ws, harnessId)
  h.splices = (h.splices ?? []).filter((s) => s.id !== spliceId)
}

/** Assign (or clear) the wire part used for a splice, feeding the BOM. */
export function assignSpliceWire(
  ws: Workspace,
  harnessId: string,
  spliceId: string,
  wirePartId?: string
): HarnessSplice {
  const h = getHarness(ws, harnessId)
  const splice = (h.splices ?? []).find((s) => s.id === spliceId)
  if (!splice) throw new Error(`Splice "${spliceId}" not found`)
  splice.wirePartId = wirePartId
  return splice
}

/** Collapse a harness into a reusable subassembly part stored in the library. */
export function saveAsSubassembly(
  ws: Workspace,
  harnessId: string,
  name: string
): SubassemblyPart {
  const h = getHarness(ws, harnessId)
  const sub = makeSubassembly(h, name, {
    name,
    type: 'Custom',
    internalPartNumber: '',
    manufacturer: '',
    manufacturerPartNumber: '',
    supplier: '',
    supplierPartNumber: ''
  })
  return addPart(ws, sub) as SubassemblyPart
}

/** Re-create a subassembly's harness in the project, matching placed devices. */
export function insertSubassembly(
  ws: Workspace,
  subassemblyId: string
): { harness: Harness; matched: number; missing: number } {
  const sub = ws.parts.find((p) => p.id === subassemblyId)
  if (!sub || sub.kind !== 'subassembly') {
    throw new Error(`Subassembly "${subassemblyId}" not found`)
  }
  const result = instantiateSubassemblyHarness(libOf(ws), ws.project.deviceInstances, sub)
  if (!result.harness) {
    throw new Error('No placed devices match the subassembly ports')
  }
  ws.project.harnesses.push(result.harness)
  return { harness: result.harness, matched: result.matched, missing: result.missing }
}

// ---------------------------------------------------------------------------
// Validation, reports, BOM, WireViz, revisions
// ---------------------------------------------------------------------------

export function validate(ws: Workspace): DrcIssue[] {
  return runDrc(libOf(ws), ws.project)
}

export function wiringTable(ws: Workspace): WiringRow[] {
  return wiringTableAll(libOf(ws), ws.project)
}

export function cutlist(ws: Workspace, slackMm = 0): CutlistRow[] {
  return buildCutlist(libOf(ws), ws.project, slackMm)
}

export function netlist(ws: Workspace): Net[] {
  return buildNetlist(libOf(ws), ws.project)
}

export function bom(ws: Workspace): BomRow[] {
  return buildBom(ws.project, libOf(ws))
}

export function bomText(ws: Workspace, format: 'csv' | 'json' = 'json'): string {
  const rows = bom(ws)
  return format === 'csv' ? bomCsv(rows) : JSON.stringify(rows, null, 2)
}

export function exportWireViz(ws: Workspace, harnessId: string): string {
  return wirevizYaml(libOf(ws), ws.project, getHarness(ws, harnessId))
}

export function importWireVizDoc(
  ws: Workspace,
  yaml: string
): { parts: Part[]; templates: PinoutTemplate[] } {
  const imported = importWireViz(yaml, libOf(ws))
  for (const p of imported.parts) addPart(ws, p)
  for (const t of imported.templates) addTemplate(ws, t)
  return imported
}

export function createRevision(ws: Workspace, label: string, description?: string) {
  const rev = makeRevision(ws.project, label, description)
  ws.project.revisions = [...(ws.project.revisions ?? []), rev]
  return rev
}

export function listRevisions(ws: Workspace) {
  return (ws.project.revisions ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    timestamp: r.timestamp
  }))
}

export function diffRevision(ws: Workspace, revisionId: string): string[] {
  const rev = (ws.project.revisions ?? []).find((r) => r.id === revisionId)
  if (!rev) throw new Error(`Revision "${revisionId}" not found`)
  return diffRevisions(rev.project, ws.project)
}

export function restoreRevision(ws: Workspace, revisionId: string): void {
  ws.project = restoreRevisionFn(ws.project, revisionId)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  name: string
  id: string
  deviceCount: number
  harnessCount: number
  wireCount: number
  partCount: number
  templateCount: number
  issues: { errors: number; warnings: number }
}

export function summarize(ws: Workspace): WorkspaceSummary {
  const issues = validate(ws)
  return {
    name: ws.project.name,
    id: ws.project.id,
    deviceCount: ws.project.deviceInstances.length,
    harnessCount: ws.project.harnesses.length,
    wireCount: ws.project.harnesses.reduce((n, h) => n + h.wires.length, 0),
    partCount: ws.parts.length,
    templateCount: ws.templates.length,
    issues: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length
    }
  }
}

export function harnessDetail(ws: Workspace, harnessId: string) {
  const h = getHarness(ws, harnessId)
  const lib = libOf(ws)
  const { resolved } = resolveAllEndpoints(lib, ws.project.deviceInstances, h)
  return {
    id: h.id,
    name: h.name,
    description: h.description,
    notes: h.notes,
    endpoints: h.endpoints.map((ep, i) => {
      const re = resolveEndpoint(lib, ws.project.deviceInstances, ep)
      return {
        end: endLabel(i),
        deviceInstanceId: ep.deviceInstanceId,
        deviceLabel: re?.instance.label ?? '(unresolved)',
        portId: ep.portId,
        portName: re?.port.name ?? '(unresolved)',
        connector: re?.connector?.name,
        pins: re?.pins ?? []
      }
    }),
    wires: h.wires.map((w) => ({
      ...w,
      fromSignal: resolved
        .get(w.from.end)
        ?.pins.find((p) => p.position === w.from.position)?.signal,
      toSignal: resolved
        .get(w.to.end)
        ?.pins.find((p) => p.position === w.to.position)?.signal
    })),
    segments: h.segments,
    accessories: h.accessories ?? [],
    splices: h.splices ?? []
  }
}

export { isWire, isDevice }
