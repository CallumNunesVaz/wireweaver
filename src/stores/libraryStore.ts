import { create } from 'zustand'
import type { Part, PinoutTemplate } from '../model/types'
import type { LibraryLike } from '../model/derivation'
import { seedLibrary } from '../model/seed'
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
  /** Set when a library file exists but could not be read. */
  loadError: string | null
  load: () => Promise<void>
  /** After a load error: proceed with an empty library and resume saving. */
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

const persistParts = debounced(async (parts: Part[]) => {
  try {
    await window.ww?.library?.saveParts(parts)
  } catch {
    toast('Failed to save library parts to disk.', 'error')
  }
}, 500)

const persistTemplates = debounced(async (templates: PinoutTemplate[]) => {
  try {
    await window.ww?.library?.saveTemplates(templates)
  } catch {
    toast('Failed to save pinout templates to disk.', 'error')
  }
}, 500)

/** Write any pending library edits now (before quit or a folder switch). */
export async function flushLibraryWrites(): Promise<void> {
  await Promise.all([persistParts.flush(), persistTemplates.flush()])
}

if (typeof window !== 'undefined' && !(window as { __ww_persistFlush__?: boolean }).__ww_persistFlush__) {
  ;(window as { __ww_persistFlush__?: boolean }).__ww_persistFlush__ = true
  window.addEventListener('beforeunload', () => {
    void flushLibraryWrites()
  })
}

function isPartLike(p: unknown): p is Part {
  const o = p as Partial<Part> | null
  return (
    !!o &&
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    (o.kind === 'device' || o.kind === 'connector' || o.kind === 'wire' || o.kind === 'subassembly')
  )
}

function isTemplateLike(t: unknown): t is PinoutTemplate {
  const o = t as Partial<PinoutTemplate> | null
  return !!o && typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.pins)
}

type Get = () => { loadError: string | null }
// While a load error is unresolved, writes would replace the user's real
// library with whatever is in memory, so they are held back.
function persistPartsGuarded(get: Get, parts: Part[]): void {
  if (!get().loadError) persistParts.call(parts)
}
function persistTemplatesGuarded(get: Get, templates: PinoutTemplate[]): void {
  if (!get().loadError) persistTemplates.call(templates)
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  parts: [],
  templates: [],
  libraryPath: '',
  loaded: false,
  loadError: null,

  load: async () => {
    const libPath = await window.ww?.library.getPath()
    const res = await window.ww?.library.load()
    if (!res) return
    if (res.error) {
      // Never seed over (and later overwrite) a library we failed to read.
      set({ parts: [], templates: [], libraryPath: libPath, loaded: true, loadError: res.error })
      return
    }
    const parts = (res.parts ?? []).filter(isPartLike)
    const templates = (res.templates ?? []).filter(isTemplateLike)
    if (res.isNew && parts.length === 0 && templates.length === 0) {
      const seed = seedLibrary()
      set({ parts: seed.parts, templates: seed.templates, libraryPath: libPath, loaded: true, loadError: null })
      persistPartsGuarded(get, seed.parts)
      persistTemplatesGuarded(get, seed.templates)
      return
    }
    set({ parts, templates, libraryPath: libPath, loaded: true, loadError: null })
  },

  acceptEmptyLibrary: () => set({ loadError: null }),

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
    persistPartsGuarded(get, parts)
  },

  removePart: (id) => {
    const parts = get().parts.filter((p) => p.id !== id)
    set({ parts })
    persistPartsGuarded(get, parts)
  },

  upsertTemplate: (template) => {
    const templates = get().templates.slice()
    const i = templates.findIndex((t) => t.id === template.id)
    if (i >= 0) templates[i] = template
    else templates.push(template)
    set({ templates })
    persistTemplatesGuarded(get, templates)
  },

  removeTemplate: (id) => {
    const templates = get().templates.filter((t) => t.id !== id)
    set({ templates })
    persistTemplatesGuarded(get, templates)
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
      persistPartsGuarded(get, next)
    }
    if (newTemplates.length) {
      const next = [...templates, ...newTemplates]
      set({ templates: next })
      persistTemplatesGuarded(get, next)
    }
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
