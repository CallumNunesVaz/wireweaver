import { create } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type {
  Harness,
  HarnessAccessory,
  HarnessEndpoint,
  HarnessWire,
  Project
} from '../model/types'
import { parseProjectFile } from '../model/project-file'
import * as ops from '../model/ops'


interface ProjectState {
  project: Project
  filePath?: string
  dirty: boolean

  // instances
  addInstance: (partId: string, position: { x: number; y: number }, label: string) => string
  updateInstancePosition: (id: string, position: { x: number; y: number }) => void
  /** Bulk position update — one undo step for alignment. */
  updateInstancePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void
  setInstanceLabel: (id: string, label: string) => void
  removeInstance: (id: string) => void
  /** Remove several instances (and prune their harness endpoints) as one undo step. */
  removeInstances: (ids: string[]) => void
  duplicateInstance: (id: string) => void

  // harnesses
  addHarness: (endpoints: HarnessEndpoint[], name?: string) => string | undefined
  /** Insert a fully-formed harness (e.g. from a subassembly), assigning a new id. */
  importHarness: (harness: Harness) => string
  /** Add an endpoint to a harness. Returns true if it was new, false if already present. */
  addEndpointToHarness: (harnessId: string, endpoint: HarnessEndpoint) => boolean
  /** Find the harness id that contains this endpoint, if any. */
  findHarnessByEndpoint: (deviceInstanceId: string, portId: string) => string | undefined
  updateHarness: (id: string, patch: Partial<Omit<Harness, 'id'>>) => void
  setHarnessWires: (id: string, wires: HarnessWire[]) => void
  setHarnessSegment: (id: string, fromEnd: string, toEnd: string, patch: { lengthMm?: number; label?: string }) => void
  removeHarness: (id: string) => void
  duplicateHarness: (id: string) => void

  // harness accessories
  addHarnessAccessory: (harnessId: string, acc: Omit<HarnessAccessory, 'id'>) => void
  removeHarnessAccessory: (harnessId: string, accId: string) => void

  // splices
  addSplice: (harnessId: string, wireIds: string[]) => void
  removeSplice: (harnessId: string, spliceId: string) => void
  assignSpliceWire: (harnessId: string, spliceId: string, wirePartId: string) => void
  moveSplice: (harnessId: string, spliceId: string, position: { x: number; y: number }) => void

  // revisions
  addRevision: (label: string, description?: string) => void
  restoreRevision: (revisionId: string) => void

  // whole-project
  setProjectMeta: (
    patch: Partial<Pick<Project, 'name' | 'revision' | 'author' | 'description'>>
  ) => void
  /** Load parsed `.wwv` JSON; throws FileFormatError when it is not valid. */
  loadProject: (data: unknown, filePath?: string) => void
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
    templateSnapshots: {},
    revisions: []
  }
}

/**
 * Apply an ops result. A no-op (ops return the same Project reference when
 * nothing changed) leaves the state untouched: no dirty flag, no subscriber
 * notification, no undo entry.
 */
function commit<S extends { project: Project }>(s: S, next: Project): S | (Partial<S> & { project: Project; dirty: true }) {
  return next === s.project ? s : ({ project: next, dirty: true } as Partial<S> & { project: Project; dirty: true })
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      filePath: undefined,
      dirty: false,

      addInstance: (partId, position, label) => {
        flushCoalesce()
        const { project, id } = ops.addInstance(get().project, partId, position, label)
        set((s) => commit(s, project))
        return id
      },

      updateInstancePosition: (id, position) => {
        flushCoalesce()
        set((s) => commit(s, ops.updateInstancePosition(s.project, id, position)))
      },

      updateInstancePositions: (updates) => {
        flushCoalesce()
        set((s) => commit(s, ops.updateInstancePositions(s.project, updates)))
      },

      setInstanceLabel: (id, label) => {
        coalesceUndo(() =>
          set((s) => commit(s, ops.setInstanceLabel(s.project, id, label)))
        )
      },

      removeInstance: (id) => get().removeInstances([id]),

      removeInstances: (ids) => {
        flushCoalesce()
        if (ids.length === 0) return
        set((s) => commit(s, ops.removeInstances(s.project, ids)))
      },

      duplicateInstance: (id) => {
        flushCoalesce()
        set((s) => commit(s, ops.duplicateInstance(s.project, id)))
      },

      addHarness: (endpoints, name) => {
        flushCoalesce()
        const r = ops.addHarness(get().project, endpoints, name)
        if (!r) return undefined
        set((s) => commit(s, r.project))
        return r.id
      },

      importHarness: (harness) => {
        flushCoalesce()
        const { project, id } = ops.importHarness(get().project, harness)
        set((s) => commit(s, project))
        return id
      },

      addEndpointToHarness: (harnessId, endpoint) => {
        flushCoalesce()
        const { project, added } = ops.addEndpoint(get().project, harnessId, endpoint)
        set((s) => commit(s, project))
        return added
      },

      findHarnessByEndpoint: (deviceInstanceId, portId) => {
        return ops.findHarnessByEndpoint(get().project.harnesses, deviceInstanceId, portId)
      },

      updateHarness: (id, patch) => {
        coalesceUndo(() =>
          set((s) => commit(s, ops.updateHarness(s.project, id, patch)))
        )
      },

      setHarnessWires: (id, wires) => {
        flushCoalesce()
        set((s) => commit(s, ops.setWires(s.project, id, wires)))
      },

      setHarnessSegment: (id, fromEnd, toEnd, patch) => {
        flushCoalesce()
        set((s) => commit(s, ops.upsertSegment(s.project, id, fromEnd, toEnd, patch)))
      },

      removeHarness: (id) => {
        flushCoalesce()
        set((s) => commit(s, ops.removeHarness(s.project, id)))
      },

      duplicateHarness: (id) => {
        flushCoalesce()
        set((s) => commit(s, ops.duplicateHarness(s.project, id)))
      },

      addHarnessAccessory: (harnessId, acc) => {
        flushCoalesce()
        set((s) => {
          const r = ops.addHarnessAccessory(s.project, harnessId, acc)
          return commit(s, r.project)
        })
      },

      removeHarnessAccessory: (harnessId, accId) => {
        flushCoalesce()
        set((s) => commit(s, ops.removeHarnessAccessory(s.project, harnessId, accId)))
      },

      addSplice: (harnessId, wireIds) => {
        flushCoalesce()
        set((s) => {
          const r = ops.addSplice(s.project, harnessId, wireIds)
          return commit(s, r.project)
        })
      },

      removeSplice: (harnessId, spliceId) => {
        flushCoalesce()
        set((s) => commit(s, ops.removeSplice(s.project, harnessId, spliceId)))
      },

      moveSplice: (harnessId, spliceId, position) => {
        flushCoalesce()
        set((s) => commit(s, ops.moveSplice(s.project, harnessId, spliceId, position)))
      },

      assignSpliceWire: (harnessId, spliceId, wirePartId) => {
        flushCoalesce()
        set((s) => commit(s, ops.assignSpliceWire(s.project, harnessId, spliceId, wirePartId).project))
      },

      addRevision: (label, description) => {
        flushCoalesce()
        set((s) => {
          const r = ops.addRevision(s.project, label, description)
          return commit(s, r.project)
        })
      },

      restoreRevision: (revisionId) => {
        flushCoalesce()
        set((s) => commit(s, ops.restoreRevision(s.project, revisionId)))
      },

      setProjectMeta: (patch) => {
        coalesceUndo(() =>
          set((s) => commit(s, ops.setProjectMeta(s.project, patch)))
        )
      },

      loadProject: (data, filePath) => {
        const project = parseProjectFile(data)
        flushCoalesce()
        set({ project, filePath, dirty: false })
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
      partialize: (s) => ({ project: s.project }),
      equality: (a, b) => a.project === b.project,
      limit: 100
    }
  )
)

// ---------- Undo coalescing ----------
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
