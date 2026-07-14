import { create } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type {
  DeviceInstance,
  Harness,
  HarnessWire,
  Project
} from '../model/types'
import { suggestHarnessName } from '../model/derivation'

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
  addHarness: (
    a: Harness['a'],
    b: Harness['b'],
    name?: string
  ) => string | undefined
  updateHarness: (id: string, patch: Partial<Omit<Harness, 'id'>>) => void
  setHarnessWires: (id: string, wires: HarnessWire[]) => void
  removeHarness: (id: string) => void

  // whole-project
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

/** True if the port is already the endpoint of some harness (one harness per port, v1). */
function portOccupied(
  harnesses: Harness[],
  deviceInstanceId: string,
  portId: string
): boolean {
  return harnesses.some(
    (h) =>
      (h.a.deviceInstanceId === deviceInstanceId && h.a.portId === portId) ||
      (h.b.deviceInstanceId === deviceInstanceId && h.b.portId === portId)
  )
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
        // Coalesced: typing a label produces one undo step, not one per keystroke.
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
            harnesses: s.project.harnesses.filter(
              (h) => h.a.deviceInstanceId !== id && h.b.deviceInstanceId !== id
            )
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

      addHarness: (a, b, name) => {
        flushCoalesce()
        const { harnesses, deviceInstances } = get().project
        if (a.deviceInstanceId === b.deviceInstanceId) return undefined
        if (portOccupied(harnesses, a.deviceInstanceId, a.portId)) return undefined
        if (portOccupied(harnesses, b.deviceInstanceId, b.portId)) return undefined
        const id = nanoid()
        const harness: Harness = {
          id,
          name:
            name ??
            suggestHarnessName(deviceInstances, a.deviceInstanceId, b.deviceInstanceId),
          a,
          b,
          wires: []
        }
        set((s) => ({
          project: { ...s.project, harnesses: [...s.project.harnesses, harness] },
          dirty: true
        }))
        return id
      },

      updateHarness: (id, patch) => {
        // Coalesced: name/length field edits merge into one undo step.
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
              h.id === id ? { ...h, wires } : h
            )
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

      loadProject: (project, filePath) => {
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
