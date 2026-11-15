/**
 * On-disk formats: versioning, validation and migration for `.wwv` projects
 * and `.wwlib` libraries. Every load path (app open, crash recovery, MCP
 * server, API) goes through here so a malformed or future-version file fails
 * with a clear message instead of crashing a render later.
 */
import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessEndpoint,
  HarnessWire,
  Part,
  PinoutTemplate,
  Project
} from './types'

/**
 * 1 — unversioned files from before versioning (two-ended harnesses with
 *     `a`/`b` endpoints are migrated).
 * 2 — explicit `schemaVersion`, multi-endpoint harnesses.
 */
export const PROJECT_SCHEMA_VERSION = 2
export const LIBRARY_SCHEMA_VERSION = 1

export class FileFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileFormatError'
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function point(v: unknown): { x: number; y: number } {
  return isObj(v) ? { x: num(v.x), y: num(v.y) } : { x: 0, y: 0 }
}

function endpoint(v: unknown): HarnessEndpoint | null {
  if (!isObj(v) || typeof v.deviceInstanceId !== 'string' || typeof v.portId !== 'string') {
    return null
  }
  return { deviceInstanceId: v.deviceInstanceId, portId: v.portId }
}

function wire(v: unknown): HarnessWire | null {
  if (!isObj(v) || !isObj(v.from) || !isObj(v.to)) return null
  const from = { end: str(v.from.end), position: num(v.from.position, NaN) }
  const to = { end: str(v.to.end), position: num(v.to.position, NaN) }
  if (!from.end || !to.end || Number.isNaN(from.position) || Number.isNaN(to.position)) return null
  return { ...(v as unknown as HarnessWire), id: str(v.id) || nanoid(), from, to }
}

/** Normalise one harness, migrating the legacy two-ended `a`/`b` shape. */
export function normalizeHarness(raw: unknown): Harness | null {
  if (!isObj(raw)) return null
  const legacy = !Array.isArray(raw.endpoints) && isObj(raw.a) && isObj(raw.b)
  const endpoints = legacy
    ? [endpoint(raw.a), endpoint(raw.b)]
    : arr(raw.endpoints).map(endpoint)
  const segments = legacy
    ? typeof raw.lengthMm === 'number'
      ? [{ fromEnd: 'a', toEnd: 'b', lengthMm: raw.lengthMm }]
      : []
    : arr(raw.segments).filter(isObj).map((s) => ({
        fromEnd: str(s.fromEnd),
        toEnd: str(s.toEnd),
        lengthMm: typeof s.lengthMm === 'number' ? s.lengthMm : undefined,
        label: typeof s.label === 'string' ? s.label : undefined
      }))
  return {
    id: str(raw.id) || nanoid(),
    name: str(raw.name, 'Harness'),
    endpoints: endpoints.filter((e): e is HarnessEndpoint => e !== null),
    wires: arr(raw.wires).map(wire).filter((w): w is HarnessWire => w !== null),
    segments,
    layout: isObj(raw.layout) ? (raw.layout as Harness['layout']) : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    accessories: arr(raw.accessories).filter(isObj) as unknown as Harness['accessories'],
    splices: arr(raw.splices)
      .filter(isObj)
      .map((s) => ({
        id: str(s.id) || nanoid(),
        name: str(s.name, 'Splice'),
        wireIds: arr(s.wireIds).filter((x): x is string => typeof x === 'string'),
        position: isObj(s.position) ? point(s.position) : undefined,
        wirePartId: typeof s.wirePartId === 'string' ? s.wirePartId : undefined
      }))
  }
}

function instance(v: unknown): DeviceInstance | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.partId !== 'string') return null
  return { id: v.id, partId: v.partId, label: str(v.label, 'Device'), position: point(v.position) }
}

/**
 * Validate and migrate parsed `.wwv` JSON. Throws FileFormatError for files
 * that are not projects at all or come from a newer WireWeaver.
 */
export function parseProjectFile(data: unknown): Project {
  if (!isObj(data)) throw new FileFormatError('This file is not a WireWeaver project.')
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new FileFormatError(
      `This project was saved by a newer version of WireWeaver (format ${version}). Please update the app.`
    )
  }
  if (!Array.isArray(data.deviceInstances) && !Array.isArray(data.harnesses)) {
    throw new FileFormatError('This file is not a WireWeaver project (no devices or harnesses).')
  }
  const revisions = arr(data.revisions)
    .filter(isObj)
    .filter((r) => isObj(r.project))
    .map((r) => ({
      id: str(r.id) || nanoid(),
      timestamp: num(r.timestamp, Date.now()),
      label: str(r.label, 'Revision'),
      description: typeof r.description === 'string' ? r.description : undefined,
      project: parseProjectFile({ ...(r.project as Obj), revisions: [] }) as Project
    }))
    .map(({ project, ...rest }) => {
      const { revisions: _drop, ...p } = project
      void _drop
      return { ...rest, project: p }
    })
  return {
    id: str(data.id) || nanoid(),
    name: str(data.name, 'Untitled'),
    deviceInstances: arr(data.deviceInstances)
      .map(instance)
      .filter((d): d is DeviceInstance => d !== null),
    harnesses: arr(data.harnesses)
      .map(normalizeHarness)
      .filter((h): h is Harness => h !== null),
    partSnapshots: isObj(data.partSnapshots) ? (data.partSnapshots as Record<string, Part>) : {},
    templateSnapshots: isObj(data.templateSnapshots)
      ? (data.templateSnapshots as Record<string, PinoutTemplate>)
      : {},
    revisions,
    revision: typeof data.revision === 'string' ? data.revision : undefined,
    author: typeof data.author === 'string' ? data.author : undefined,
    description: typeof data.description === 'string' ? data.description : undefined
  }
}

/** Stamp the current schema version onto a project about to be written. */
export function serializeProjectFile(project: Project): Project & { schemaVersion: number } {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, ...project }
}

/** Validate a parsed `.wwlib` (or pack). Item-level checks happen on merge. */
export function parseLibraryFile(data: unknown): { parts: unknown[]; templates: unknown[] } {
  if (!isObj(data)) throw new FileFormatError('This file is not a WireWeaver library.')
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
  if (version > LIBRARY_SCHEMA_VERSION) {
    throw new FileFormatError(
      `This library was saved by a newer version of WireWeaver (format ${version}). Please update the app.`
    )
  }
  const parts = arr(data.parts)
  const templates = arr(data.templates)
  if (parts.length === 0 && templates.length === 0) {
    throw new FileFormatError('This library file contains no parts or templates.')
  }
  return { parts, templates }
}

export function serializeLibraryFile(parts: Part[], templates: PinoutTemplate[]) {
  return { schemaVersion: LIBRARY_SCHEMA_VERSION, parts, templates }
}
