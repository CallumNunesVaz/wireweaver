import { create } from 'zustand'
import type { Part, PinoutTemplate } from '../model/types'
import type { LibraryChanges } from '../ipc/contract'
import type { LibraryLike } from '../model/derivation'
import { seedLibrary } from '../model/seed'
import { isPartRecord, isTemplateRecord } from '../model/project-file'
import { toast } from '../shared/toast'

/** Debounce with a flush() escape hatch so pending writes survive app close. */
function debounced<A extends unknown[]>(fn: (...args: A) => Promise<unknown> | void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: A | undefined
  const call = (...args: A): void => {
    last = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void fn(...(last as A))
    }, ms)
  }
  const flush = async (): Promise<void> => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
    if (last) await fn(...last)
  }
  return { call, flush }
}

export interface MergeResult {
  addedParts: number
  addedTemplates: number
  skippedParts: number
  skippedTemplates: number
}

interface LibraryState {
  parts: Part[]
  templates: PinoutTemplate[]
  libraryPath: string
  loaded: boolean
  /** Set when library records could not be read; holds back writes. */
  loadError: string | null
  load: () => Promise<void>
  /** After a load error: keep the loaded (possibly partial) library and resume saving. */
  acceptEmptyLibrary: () => void
  upsertPart: (part: Part) => void
  removePart: (id: string) => void
  upsertTemplate: (template: PinoutTemplate) => void
  removeTemplate: (id: string) => void
  /**
   * Add parts/templates that are not already in the library (matched by id).
   * The single merge path for packs, .wwlib imports, WireViz and project
   * snapshots.
   */
  mergeItems: (items: { parts?: unknown[]; templates?: unknown[] }) => MergeResult
  setLibraryPath: (path: string) => Promise<void>
  relocateLibrary: (path: string) => Promise<void>
}

// Dirty records and removals since the last flush. Kept out of the store state
// so edits don't re-render; only the debounced writer reads them.
const dirtyParts = new Map<string, Part>()
const removedPartIds = new Set<string>()
const dirtyTemplates = new Map<string, PinoutTemplate>()
const removedTemplateIds = new Set<string>()

function resetDirty(): void {
  dirtyParts.clear()
  removedPartIds.clear()
  dirtyTemplates.clear()
  removedTemplateIds.clear()
}

/** Snapshot the pending changes and clear them, ready for the next write. */
function takeChanges(): LibraryChanges | null {
  const upsertParts = [...dirtyParts.values()]
  const upsertTemplates = [...dirtyTemplates.values()]
  const removePartIdsArr = [...removedPartIds]
  const removeTemplateIdsArr = [...removedTemplateIds]
  if (
    upsertParts.length === 0 &&
    upsertTemplates.length === 0 &&
    removePartIdsArr.length === 0 &&
    removeTemplateIdsArr.length === 0
  ) {
    return null
  }
  dirtyParts.clear()
  dirtyTemplates.clear()
  removedPartIds.clear()
  removedTemplateIds.clear()
  return {
    upsertParts,
    removePartIds: removePartIdsArr,
    upsertTemplates,
    removeTemplateIds: removeTemplateIdsArr
  }
}

/**
 * Put changes from a failed write back in the queue, unless a newer edit to
 * the same record has superseded them in the meantime, so they are retried
 * rather than silently lost.
 */
function requeue(c: LibraryChanges): void {
  for (const p of c.upsertParts) {
    if (!dirtyParts.has(p.id) && !removedPartIds.has(p.id)) dirtyParts.set(p.id, p)
  }
  for (const id of c.removePartIds) {
    if (!dirtyParts.has(id)) removedPartIds.add(id)
  }
  for (const t of c.upsertTemplates) {
    if (!dirtyTemplates.has(t.id) && !removedTemplateIds.has(t.id)) dirtyTemplates.set(t.id, t)
  }
  for (const id of c.removeTemplateIds) {
    if (!dirtyTemplates.has(id)) removedTemplateIds.add(id)
  }
}

const persistChanges = debounced(async () => {
  const changes = takeChanges()
  if (!changes) return
  try {
    await window.ww?.library?.applyChanges(changes)
  } catch {
    requeue(changes)
    toast('Library changes could not be saved to disk; they will be retried with your next edit.', 'error')
  }
}, 500)

/** Write any pending library edits now (before quit or a folder switch). */
export async function flushLibraryWrites(): Promise<void> {
  await persistChanges.flush()
}

if (typeof window !== 'undefined' && !(window as { __ww_persistFlush__?: boolean }).__ww_persistFlush__) {
  ;(window as { __ww_persistFlush__?: boolean }).__ww_persistFlush__ = true
  window.addEventListener('beforeunload', () => {
    void flushLibraryWrites()
  })
}

const isPartLike = isPartRecord

const isTemplateLike = isTemplateRecord

type Get = () => { loadError: string | null }
// While a load error is unresolved, writes would replace the user's real
// library with whatever is in memory, so they are held back.
function persistGuarded(get: Get): void {
  if (!get().loadError) persistChanges.call()
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  parts: [],
  templates: [],
  libraryPath: '',
  loaded: false,
  loadError: null,

  load: async () => {
    resetDirty()
    const libPath = await window.ww?.library.getPath()
    const res = await window.ww?.library.load()
    if (!res) return
    if (res.error) {
      // Show every record that did load (unreadable ones were moved aside),
      // but hold writes back and never seed until the user chooses.
      set({
        parts: (res.parts ?? []).filter(isPartLike),
        templates: (res.templates ?? []).filter(isTemplateLike),
        libraryPath: libPath,
        loaded: true,
        loadError: res.error
      })
      return
    }
    const parts = (res.parts ?? []).filter(isPartLike)
    const templates = (res.templates ?? []).filter(isTemplateLike)
    if (res.notice) toast(res.notice)
    if (res.isNew && parts.length === 0 && templates.length === 0) {
      const seed = seedLibrary()
      set({ parts: seed.parts, templates: seed.templates, libraryPath: libPath, loaded: true, loadError: null })
      for (const p of seed.parts) dirtyParts.set(p.id, p)
      for (const t of seed.templates) dirtyTemplates.set(t.id, t)
      persistGuarded(get)
      return
    }
    set({ parts, templates, libraryPath: libPath, loaded: true, loadError: null })
  },

  acceptEmptyLibrary: () => {
    set({ loadError: null })
    persistGuarded(get)
  },

  upsertPart: (part) => {
    const parts = get().parts.slice()
    const i = parts.findIndex((p) => p.id === part.id)
    const now = Date.now()
    const stamped: Part = {
      ...part,
      createdAt: part.createdAt ?? (i >= 0 ? parts[i].createdAt : now),
      updatedAt: now
    }
    if (i >= 0) parts[i] = stamped
    else parts.push(stamped)
    set({ parts })
    dirtyParts.set(stamped.id, stamped)
    removedPartIds.delete(stamped.id)
    persistGuarded(get)
  },

  removePart: (id) => {
    const parts = get().parts.filter((p) => p.id !== id)
    set({ parts })
    dirtyParts.delete(id)
    removedPartIds.add(id)
    persistGuarded(get)
  },

  upsertTemplate: (template) => {
    const templates = get().templates.slice()
    const i = templates.findIndex((t) => t.id === template.id)
    if (i >= 0) templates[i] = template
    else templates.push(template)
    set({ templates })
    dirtyTemplates.set(template.id, template)
    removedTemplateIds.delete(template.id)
    persistGuarded(get)
  },

  removeTemplate: (id) => {
    const templates = get().templates.filter((t) => t.id !== id)
    set({ templates })
    dirtyTemplates.delete(id)
    removedTemplateIds.add(id)
    persistGuarded(get)
  },

  mergeItems: (items) => {
    const result: MergeResult = { addedParts: 0, addedTemplates: 0, skippedParts: 0, skippedTemplates: 0 }
    const { parts, templates } = get()
    const partIds = new Set(parts.map((p) => p.id))
    const tplIds = new Set(templates.map((t) => t.id))
    const now = Date.now()
    const newParts: Part[] = []
    const newTemplates: PinoutTemplate[] = []
    for (const p of items.parts ?? []) {
      if (!isPartLike(p) || partIds.has(p.id)) {
        result.skippedParts++
        continue
      }
      partIds.add(p.id)
      newParts.push({ ...p, createdAt: p.createdAt ?? now, updatedAt: now })
    }
    for (const t of items.templates ?? []) {
      if (!isTemplateLike(t) || tplIds.has(t.id)) {
        result.skippedTemplates++
        continue
      }
      tplIds.add(t.id)
      newTemplates.push(t)
    }
    result.addedParts = newParts.length
    result.addedTemplates = newTemplates.length
    if (newParts.length) {
      const next = [...parts, ...newParts]
      set({ parts: next })
      for (const p of newParts) dirtyParts.set(p.id, p)
    }
    if (newTemplates.length) {
      const next = [...templates, ...newTemplates]
      set({ templates: next })
      for (const t of newTemplates) dirtyTemplates.set(t.id, t)
    }
    if (newParts.length || newTemplates.length) persistGuarded(get)
    return result
  },

  setLibraryPath: async (path) => {
    // Pending writes belong to the current folder; land them before switching.
    await flushLibraryWrites()
    const libPath = await window.ww?.library.setPath(path)
    set({ libraryPath: libPath })
    await get().load()
  },

  relocateLibrary: async (path) => {
    await flushLibraryWrites()
    const libPath = await window.ww?.library.relocatePath(path)
    set({ libraryPath: libPath })
    await get().load()
  }
}))

/** Build the Record-based view the derivation helpers expect. */
export function selectLibraryLike(state: {
  parts: Part[]
  templates: PinoutTemplate[]
}): LibraryLike {
  const parts: LibraryLike['parts'] = {}
  for (const p of state.parts) parts[p.id] = p
  const templates: LibraryLike['templates'] = {}
  for (const t of state.templates) templates[t.id] = t
  return { parts, templates }
}
