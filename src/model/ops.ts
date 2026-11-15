/**
 * Pure, immutable project mutations — the single implementation shared by the
 * Zustand store (`src/stores/projectStore.ts`, with zundo undo history) and the
 * programmatic API (`src/model/api.ts`, used by the MCP server and tests).
 *
 * Every function takes a `Project` and returns a new `Project`, never mutating
 * its inputs. When an operation would not change anything (an unknown id, an
 * empty bulk update, a duplicate endpoint, …) the *same* `Project` reference is
 * returned so callers that track identity (e.g. zundo's `equality`) can skip a
 * no-op. Functions that create an entity return `{ project, id }` so callers
 * that need the new id can obtain it.
 */
import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessAccessory,
  HarnessEndpoint,
  HarnessSplice,
  HarnessWire,
  Project,
  ProjectRevision
} from './types'
import { endIndex, endLabel } from './types'
import { pruneInstanceFromHarness, sanitizeTwists, suggestHarnessNames } from './derivation'
import { createRevision as makeRevision, restoreRevision as restoreRevisionEntity } from './revisions'
import { nextSpliceName } from './wiring'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export interface Position {
  x: number
  y: number
}

/** The id of the harness containing `(deviceInstanceId, portId)`, if any. */
export function findHarnessByEndpoint(
  harnesses: Harness[],
  deviceInstanceId: string,
  portId: string
): string | undefined {
  for (const h of harnesses) {
    for (const ep of h.endpoints) {
      if (ep.deviceInstanceId === deviceInstanceId && ep.portId === portId) return h.id
    }
  }
  return undefined
}

function updateHarnessIn(
  project: Project,
  harnessId: string,
  update: (h: Harness) => Harness
): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = update(harnesses[idx])
  return { ...project, harnesses }
}

// ---------------------------------------------------------------------------
// Device instances
// ---------------------------------------------------------------------------

export function addInstance(
  project: Project,
  partId: string,
  position: Position,
  label: string
): { project: Project; id: string } {
  const id = nanoid()
  const instance: DeviceInstance = { id, partId, label, position }
  return {
    project: { ...project, deviceInstances: [...project.deviceInstances, instance] },
    id
  }
}

export function updateInstancePosition(
  project: Project,
  id: string,
  position: Position
): Project {
  if (!project.deviceInstances.some((d) => d.id === id)) return project
  return {
    ...project,
    deviceInstances: project.deviceInstances.map((d) =>
      d.id === id ? { ...d, position } : d
    )
  }
}

export function updateInstancePositions(
  project: Project,
  updates: { id: string; position: Position }[]
): Project {
  if (updates.length === 0) return project
  const index = new Map(updates.map((u) => [u.id, u.position]))
  if (!project.deviceInstances.some((d) => index.has(d.id))) return project
  return {
    ...project,
    deviceInstances: project.deviceInstances.map((d) =>
      index.has(d.id) ? { ...d, position: index.get(d.id)! } : d
    )
  }
}

export function setInstanceLabel(project: Project, id: string, label: string): Project {
  if (!project.deviceInstances.some((d) => d.id === id)) return project
  return {
    ...project,
    deviceInstances: project.deviceInstances.map((d) => (d.id === id ? { ...d, label } : d))
  }
}

export function removeInstances(project: Project, ids: string[]): Project {
  if (ids.length === 0) return project
  const gone = new Set(ids)
  if (!project.deviceInstances.some((d) => gone.has(d.id))) return project
  let harnesses = project.harnesses
  for (const id of ids) {
    harnesses = harnesses
      .map((h) => pruneInstanceFromHarness(h, id))
      .filter((h): h is Harness => h !== null)
  }
  return {
    ...project,
    deviceInstances: project.deviceInstances.filter((d) => !gone.has(d.id)),
    harnesses
  }
}

export function duplicateInstance(project: Project, id: string): Project {
  const src = project.deviceInstances.find((d) => d.id === id)
  if (!src) return project
  const copy: DeviceInstance = {
    ...src,
    id: nanoid(),
    label: `${src.label} copy`,
    position: { x: src.position.x + 40, y: src.position.y + 40 }
  }
  return { ...project, deviceInstances: [...project.deviceInstances, copy] }
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/**
 * Add a harness between `endpoints`. If any endpoint already belongs to an
 * existing harness, that harness is extended instead (and its id returned).
 * Returns `undefined` when fewer than two endpoints are supplied.
 */
export function addHarness(
  project: Project,
  endpoints: HarnessEndpoint[],
  name?: string
): { project: Project; id: string } | undefined {
  if (endpoints.length < 2) return undefined

  for (const ep of endpoints) {
    const existingId = findHarnessByEndpoint(project.harnesses, ep.deviceInstanceId, ep.portId)
    if (existingId) {
      let next = project
      for (const ep2 of endpoints) {
        next = addEndpoint(next, existingId, ep2).project
      }
      return { project: next, id: existingId }
    }
  }

  const id = nanoid()
  const label = suggestHarnessNames(
    project.deviceInstances,
    endpoints.map((e) => e.deviceInstanceId)
  )
  const harness: Harness = {
    id,
    name: name ?? label,
    endpoints,
    wires: [],
    segments: [],
    accessories: [],
    splices: []
  }
  return { project: { ...project, harnesses: [...project.harnesses, harness] }, id }
}

/** Insert a fully-formed harness under a new id (sanitising twists and ids). */
export function importHarness(
  project: Project,
  harness: Harness
): { project: Project; id: string } {
  const id = nanoid()
  const copy: Harness = {
    ...harness,
    id,
    wires: sanitizeTwists(harness.wires),
    splices: (harness.splices ?? []).map((s) => ({ ...s, id: nanoid() })),
    accessories: (harness.accessories ?? []).map((a) => ({ ...a, id: nanoid() }))
  }
  return { project: { ...project, harnesses: [...project.harnesses, copy] }, id }
}

/** Append a harness, keeping its id (used by `createHarness` and subassemblies). */
export function insertHarness(project: Project, harness: Harness): Project {
  return { ...project, harnesses: [...project.harnesses, harness] }
}

/**
 * Append an endpoint to a harness. Returns `added: false` (and the same project
 * reference) when the harness does not exist or the endpoint already belongs to
 * any harness.
 */
export function addEndpoint(
  project: Project,
  harnessId: string,
  endpoint: HarnessEndpoint
): { project: Project; added: boolean } {
  if (!project.harnesses.some((h) => h.id === harnessId)) {
    return { project, added: false }
  }
  if (findHarnessByEndpoint(project.harnesses, endpoint.deviceInstanceId, endpoint.portId)) {
    return { project, added: false }
  }
  return {
    project: updateHarnessIn(project, harnessId, (h) => ({
      ...h,
      endpoints: [...h.endpoints, endpoint]
    })),
    added: true
  }
}

/** Remove an endpoint by label, remapping surviving wires/segments/layout. */
export function removeEndpoint(project: Project, harnessId: string, end: string): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  const endIdx = endIndex(end)
  if (endIdx < 0 || endIdx >= h.endpoints.length) return project

  const remap = new Map<string, string>()
  const endpoints: HarnessEndpoint[] = []
  h.endpoints.forEach((e, i) => {
    if (i === endIdx) return
    remap.set(endLabel(i), endLabel(endpoints.length))
    endpoints.push(e)
  })
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
  let layout: Harness['layout']
  if (h.layout) {
    layout = {}
    for (const [label, pos] of Object.entries(h.layout)) {
      const next = remap.get(label)
      if (next) layout[next] = pos
    }
  }
  const survivingIds = new Set(wires.map((w) => w.id))
  const splices = h.splices
    ? h.splices
        .map((s) => ({ ...s, wireIds: s.wireIds.filter((id) => survivingIds.has(id)) }))
        .filter((s) => s.wireIds.length >= 2)
    : undefined

  const harnesses = project.harnesses.slice()
  harnesses[idx] = { ...h, endpoints, wires, segments, layout, splices }
  return { ...project, harnesses }
}

export function updateHarness(
  project: Project,
  id: string,
  patch: Partial<Omit<Harness, 'id'>>
): Project {
  return updateHarnessIn(project, id, (h) => ({ ...h, ...patch }))
}

export function setWires(project: Project, id: string, wires: HarnessWire[]): Project {
  return updateHarnessIn(project, id, (h) => ({ ...h, wires: sanitizeTwists(wires) }))
}

export function addWire(project: Project, id: string, wire: HarnessWire): Project {
  return updateHarnessIn(project, id, (h) => ({ ...h, wires: [...h.wires, wire] }))
}

export function updateWire(
  project: Project,
  harnessId: string,
  wireId: string,
  patch: Partial<Omit<HarnessWire, 'id'>>
): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  if (!h.wires.some((w) => w.id === wireId)) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = {
    ...h,
    wires: h.wires.map((w) => (w.id === wireId ? { ...w, ...patch } : w))
  }
  return { ...project, harnesses }
}

export function removeWire(project: Project, harnessId: string, wireId: string): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  if (!h.wires.some((w) => w.id === wireId)) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = { ...h, wires: h.wires.filter((w) => w.id !== wireId) }
  return { ...project, harnesses }
}

export function upsertSegment(
  project: Project,
  id: string,
  fromEnd: string,
  toEnd: string,
  patch: { lengthMm?: number; label?: string }
): Project {
  return updateHarnessIn(project, id, (h) => {
    const segs = [...h.segments]
    const idx = segs.findIndex((seg) => seg.fromEnd === fromEnd && seg.toEnd === toEnd)
    if (idx >= 0) segs[idx] = { ...segs[idx], ...patch }
    else segs.push({ fromEnd, toEnd, ...patch })
    return { ...h, segments: segs }
  })
}

export function removeHarness(project: Project, id: string): Project {
  if (!project.harnesses.some((h) => h.id === id)) return project
  return { ...project, harnesses: project.harnesses.filter((h) => h.id !== id) }
}

export function duplicateHarness(project: Project, id: string): Project {
  const src = project.harnesses.find((h) => h.id === id)
  if (!src) return project
  // Two passes: assign every new wire id first, then remap twistedWith,
  // otherwise a wire can reference a mate whose new id isn't known yet.
  const wireIds = new Map<string, string>()
  for (const w of src.wires) wireIds.set(w.id, nanoid())
  const wires = src.wires.map((w) => ({
    ...w,
    id: wireIds.get(w.id)!,
    twistedWith: w.twistedWith ? wireIds.get(w.twistedWith) ?? undefined : undefined
  }))
  const copy: Harness = {
    ...src,
    id: nanoid(),
    name: `${src.name} copy`,
    wires,
    splices:
      src.splices?.map((s) => ({
        ...s,
        id: nanoid(),
        wireIds: s.wireIds.map((wid) => wireIds.get(wid) ?? wid)
      })) ?? [],
    accessories: src.accessories?.map((a) => ({ ...a, id: nanoid() })) ?? []
  }
  return { ...project, harnesses: [...project.harnesses, copy] }
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

export function addHarnessAccessory(
  project: Project,
  harnessId: string,
  acc: Omit<HarnessAccessory, 'id'>
): { project: Project; id: string } {
  const id = nanoid()
  const accessory: HarnessAccessory = { ...acc, id }
  return {
    project: updateHarnessIn(project, harnessId, (h) => ({
      ...h,
      accessories: [...(h.accessories ?? []), accessory]
    })),
    id
  }
}

export function removeHarnessAccessory(
  project: Project,
  harnessId: string,
  accId: string
): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  if (!(h.accessories ?? []).some((a) => a.id === accId)) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = {
    ...h,
    accessories: (h.accessories ?? []).filter((a) => a.id !== accId)
  }
  return { ...project, harnesses }
}

// ---------------------------------------------------------------------------
// Splices
// ---------------------------------------------------------------------------

export function addSplice(
  project: Project,
  harnessId: string,
  wireIds: string[],
  name?: string
): { project: Project; id: string } {
  const id = nanoid()
  const h = project.harnesses.find((x) => x.id === harnessId)
  const splice: HarnessSplice = { id, name: name ?? nextSpliceName(h?.splices), wireIds }
  return {
    project: updateHarnessIn(project, harnessId, (h) => ({
      ...h,
      splices: [...(h.splices ?? []), splice]
    })),
    id
  }
}

export function removeSplice(project: Project, harnessId: string, spliceId: string): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  if (!(h.splices ?? []).some((sp) => sp.id === spliceId)) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = { ...h, splices: (h.splices ?? []).filter((sp) => sp.id !== spliceId) }
  return { ...project, harnesses }
}

export function moveSplice(
  project: Project,
  harnessId: string,
  spliceId: string,
  position: Position
): Project {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return project
  const h = project.harnesses[idx]
  if (!(h.splices ?? []).some((sp) => sp.id === spliceId)) return project
  const harnesses = project.harnesses.slice()
  harnesses[idx] = {
    ...h,
    splices: (h.splices ?? []).map((sp) => (sp.id === spliceId ? { ...sp, position } : sp))
  }
  return { ...project, harnesses }
}

/** Assign (or clear) the wire part used for a splice. */
export function assignSpliceWire(
  project: Project,
  harnessId: string,
  spliceId: string,
  wirePartId?: string
): { project: Project; found: boolean } {
  const idx = project.harnesses.findIndex((h) => h.id === harnessId)
  if (idx < 0) return { project, found: false }
  const h = project.harnesses[idx]
  if (!(h.splices ?? []).some((sp) => sp.id === spliceId)) return { project, found: false }
  const harnesses = project.harnesses.slice()
  harnesses[idx] = {
    ...h,
    splices: (h.splices ?? []).map((sp) => (sp.id === spliceId ? { ...sp, wirePartId } : sp))
  }
  return { project: { ...project, harnesses }, found: true }
}

// ---------------------------------------------------------------------------
// Revisions and project meta
// ---------------------------------------------------------------------------

export function addRevision(
  project: Project,
  label: string,
  description?: string
): { project: Project; revision: ProjectRevision } {
  const revision = makeRevision(project, label, description)
  return {
    project: { ...project, revisions: [...(project.revisions ?? []), revision] },
    revision
  }
}

export function restoreRevision(project: Project, revisionId: string): Project {
  return restoreRevisionEntity(project, revisionId)
}

export function setProjectMeta(
  project: Project,
  patch: Partial<Pick<Project, 'name' | 'revision' | 'author' | 'description'>>
): Project {
  if (Object.keys(patch).length === 0) return project
  return { ...project, ...patch }
}
