import { create } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessEndpoint,
  HarnessWire,
  Project
} from '../model/types'
import {
  pruneInstanceFromHarness,
  sanitizeTwists,
  suggestHarnessNames
} from '../model/derivation'

interface ProjectState {
  project: Project
  filePath?: string
  dirty: boolean

  // instances
  addInstance: (partId: string, position: { x: number; y: number }, label: string) => string
  updateInstancePosition: (id: string, position: { x: number; y: number }) => void
  setInstanceLabel: (id: string, label: string) => void
  removeInstance: (id: string) => void
  duplicateInstance: (id: string) => void

  // harnesses
  addHarness: (endpoints: HarnessEndpoint[], name?: string) => string | undefined
  /** Add an endpoint to a harness. Returns true if it was new, false if already present. */
  addEndpointToHarness: (harnessId: string, endpoint: HarnessEndpoint) => boolean
  /** Find the harness id that contains this endpoint, if any. */
  findHarnessByEndpoint: (deviceInstanceId: string, portId: string) => string | undefined
  updateHarness: (id: string, patch: Partial<Omit<Harness, 'id'>>) => void
  setHarnessWires: (id: string, wires: HarnessWire[]) => void
  setHarnessSegment: (id: string, fromEnd: string, toEnd: string, patch: { lengthMm?: number; label?: string }) => void
  removeHarness: (id: string) => void

  // whole-project
  setProjectMeta: (
    patch: Partial<Pick<Project, 'name' | 'revision' | 'author' | 'description'>>
  ) => void
  loadProject: (project: Project, filePath?: string) => void
  newProject: () => void
  markSaved: (filePath?: string) => void
  markDirty: () => void
}

function emptyProject(): Project {
  return {
    id: nanoid(),
    name: 'Untitled',
    deviceInstances: [],
    harnesses: [],
    partSnapshots: {},
    templateSnapshots: {}
  }
}

function ensureHarness(h: Harness): Harness {
  const maybeOld = h as unknown as { a?: HarnessEndpoint; b?: HarnessEndpoint; lengthMm?: number; description?: string; notes?: string }
  if (!h.endpoints && maybeOld.a) {
    return {
      id: h.id,
      name: h.name,
      endpoints: [maybeOld.a!, maybeOld.b!],
      wires: h.wires ?? [],
      segments: maybeOld.lengthMm != null
        ? [{ fromEnd: 'a', toEnd: 'b', lengthMm: maybeOld.lengthMm }]
        : [],
      description: maybeOld.description,
      notes: maybeOld.notes
    }
  }
  return {
    id: h.id,
    name: h.name,
    endpoints: h.endpoints ?? [],
    wires: h.wires ?? [],
    segments: h.segments ?? [],
    layout: h.layout,
    description: h.description,
    notes: h.notes
  }
}

function endpointMatches(e: HarnessEndpoint, deviceInstanceId: string, portId: string): boolean {
  return e.deviceInstanceId === deviceInstanceId && e.portId === portId
}

function findHarnessByEndpoint(
  harnesses: Harness[],
  deviceInstanceId: string,
  portId: string
): string | undefined {
  for (const h of harnesses) {
    for (const ep of h.endpoints) {
      if (endpointMatches(ep, deviceInstanceId, portId)) return h.id
    }
  }
  return undefined
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      filePath: undefined,
      dirty: false,

      addInstance: (partId, position, label) => {
        flushCoalesce()
        const id = nanoid()
        const instance: DeviceInstance = { id, partId, label, position }
        set((s) => ({
          project: {
            ...s.project,
            deviceInstances: [...s.project.deviceInstances, instance]
          },
          dirty: true
        }))
        return id
      },

      updateInstancePosition: (id, position) => {
        flushCoalesce()
        set((s) => ({
          project: {
            ...s.project,
            deviceInstances: s.project.deviceInstances.map((d) =>
              d.id === id ? { ...d, position } : d
            )
          },
          dirty: true
        }))
      },

      setInstanceLabel: (id, label) => {
        coalesceUndo(() =>
          set((s) => ({
            project: {
              ...s.project,
              deviceInstances: s.project.deviceInstances.map((d) =>
                d.id === id ? { ...d, label } : d
              )
            },
            dirty: true
          }))
        )
      },

      removeInstance: (id) => {
        flushCoalesce()
        set((s) => ({
          project: {
            ...s.project,
            deviceInstances: s.project.deviceInstances.filter((d) => d.id !== id),
            harnesses: s.project.harnesses
              .map((h) => pruneInstanceFromHarness(h, id))
              .filter((h): h is Harness => h !== null)
          },
          dirty: true
        }))
      },

      duplicateInstance: (id) => {
        flushCoalesce()
        const src = get().project.deviceInstances.find((d) => d.id === id)
        if (!src) return
        const copy: DeviceInstance = {
          ...src,
          id: nanoid(),
          label: `${src.label} copy`,
          position: { x: src.position.x + 40, y: src.position.y + 40 }
        }
        set((s) => ({
          project: {
            ...s.project,
            deviceInstances: [...s.project.deviceInstances, copy]
          },
          dirty: true
        }))
      },

      addHarness: (endpoints, name) => {
        flushCoalesce()
        if (endpoints.length < 2) return undefined
        const { harnesses, deviceInstances } = get().project

        // Check if any endpoint is already in a harness — if so, join it
        for (const ep of endpoints) {
          const existingId = findHarnessByEndpoint(harnesses, ep.deviceInstanceId, ep.portId)
          if (existingId) {
            for (const ep2 of endpoints) {
              addEndpointToHarnessFn(existingId, ep2)
            }
            return existingId
          }
        }

        const id = nanoid()
        const labels = suggestHarnessNames(
          deviceInstances,
          endpoints.map((e) => e.deviceInstanceId)
        )
        const harness: Harness = {
          id,
          name: name ?? labels,
          endpoints,
          wires: [],
          segments: []
        }
        set((s) => ({
          project: { ...s.project, harnesses: [...s.project.harnesses, harness] },
          dirty: true
        }))
        return id
      },

      addEndpointToHarness: (harnessId, endpoint) => {
        flushCoalesce()
        return addEndpointToHarnessFn(harnessId, endpoint)
      },

      findHarnessByEndpoint: (deviceInstanceId, portId) => {
        return findHarnessByEndpoint(get().project.harnesses, deviceInstanceId, portId)
      },

      updateHarness: (id, patch) => {
        coalesceUndo(() =>
          set((s) => ({
            project: {
              ...s.project,
              harnesses: s.project.harnesses.map((h) =>
                h.id === id ? { ...h, ...patch } : h
              )
            },
            dirty: true
          }))
        )
      },

      setHarnessWires: (id, wires) => {
        flushCoalesce()
        set((s) => ({
          project: {
            ...s.project,
            harnesses: s.project.harnesses.map((h) =>
              h.id === id ? { ...h, wires: sanitizeTwists(wires) } : h
            )
          },
          dirty: true
        }))
      },

      setHarnessSegment: (id, fromEnd, toEnd, patch) => {
        flushCoalesce()
        set((s) => ({
          project: {
            ...s.project,
            harnesses: s.project.harnesses.map((h) => {
              if (h.id !== id) return h
              const segs = [...h.segments]
              const idx = segs.findIndex((seg) => seg.fromEnd === fromEnd && seg.toEnd === toEnd)
              if (idx >= 0) {
                segs[idx] = { ...segs[idx], ...patch }
              } else {
                segs.push({ fromEnd, toEnd, ...patch })
              }
              return { ...h, segments: segs }
            })
          },
          dirty: true
        }))
      },

      removeHarness: (id) => {
        flushCoalesce()
        set((s) => ({
          project: {
            ...s.project,
            harnesses: s.project.harnesses.filter((h) => h.id !== id)
          },
          dirty: true
        }))
      },

      setProjectMeta: (patch) => {
        coalesceUndo(() =>
          set((s) => ({ project: { ...s.project, ...patch }, dirty: true }))
        )
      },

      loadProject: (project, filePath) => {
        flushCoalesce()
        set({
          project: {
            ...project,
            harnesses: project.harnesses.map(ensureHarness)
          },
          filePath,
          dirty: false
        })
      },

      newProject: () => {
        flushCoalesce()
        set({ project: emptyProject(), filePath: undefined, dirty: false })
      },

      markSaved: (filePath) => {
        set((s) => ({ filePath: filePath ?? s.filePath, dirty: false }))
      },

      markDirty: () => {
        set({ dirty: true })
      }
    }),
    {
      // Only diagram content participates in undo history; transient flags don't.
      partialize: (s) => ({ project: s.project }),
      // Skip history entries when the project itself didn't change (e.g. the
      // dirty flag flipping on save) — reference equality is exact because every
      // real edit builds a new project object.
      equality: (a, b) => a.project === b.project,
      limit: 100
    }
  )
)

// ---------- Undo coalescing ----------
// The first edit in a burst is recorded, then history pauses until the burst
// goes idle — so keystroke-level edits (labels, names) and arrow-key nudges
// collapse into single undo steps. Discrete actions call flushCoalesce() first
// so they always record even if they land inside a burst's idle window.
let coalesceTimer: ReturnType<typeof setTimeout> | null = null
let inCoalesce = false

export function coalesceUndo(apply: () => void, idleMs = 600): void {
  if (coalesceTimer) clearTimeout(coalesceTimer)
  inCoalesce = true
  try {
    apply()
  } finally {
    inCoalesce = false
  }
  useProjectStore.temporal.getState().pause()
  coalesceTimer = setTimeout(() => {
    useProjectStore.temporal.getState().resume()
    coalesceTimer = null
  }, idleMs)
}

function flushCoalesce(): void {
  if (inCoalesce || !coalesceTimer) return
  clearTimeout(coalesceTimer)
  coalesceTimer = null
  useProjectStore.temporal.getState().resume()
}

function addEndpointToHarnessFn(harnessId: string, endpoint: HarnessEndpoint): boolean {
  const { harnesses } = useProjectStore.getState().project
  if (!harnesses.some((h) => h.id === harnessId)) return false
  // A port belongs to at most one harness — refuse if it's already an
  // endpoint anywhere (including this harness).
  if (findHarnessByEndpoint(harnesses, endpoint.deviceInstanceId, endpoint.portId)) {
    return false
  }
  useProjectStore.setState((s) => ({
    project: {
      ...s.project,
      harnesses: s.project.harnesses.map((h) =>
        h.id === harnessId ? { ...h, endpoints: [...h.endpoints, endpoint] } : h
      )
    },
    dirty: true
  }))
  return true
}
