import { create } from 'zustand'
import type { Part, PinoutTemplate } from '../model/types'
import type { LibraryLike } from '../model/derivation'
import { seedLibrary } from '../model/seed'
import { toast } from '../shared/toast'

/** Debounce with a flush() escape hatch so pending writes survive app close. */
function debounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: A | undefined
  const call = (...args: A): void => {
    last = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...(last as A))
    }, ms)
  }
  const flush = (): void => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
    if (last) fn(...last)
  }
  return { call, flush }
}

interface LibraryState {
  parts: Part[]
  templates: PinoutTemplate[]
  loaded: boolean
  load: () => Promise<void>
  upsertPart: (part: Part) => void
  removePart: (id: string) => void
  upsertTemplate: (template: PinoutTemplate) => void
  removeTemplate: (id: string) => void
}

const persistParts = debounced((parts: Part[]) => {
  window.ww?.library
    .saveParts(parts)
    .catch(() => toast('Failed to save library parts to disk.', 'error'))
}, 500)

const persistTemplates = debounced((templates: PinoutTemplate[]) => {
  window.ww?.library
    .saveTemplates(templates)
    .catch(() => toast('Failed to save pinout templates to disk.', 'error'))
}, 500)

// Flush pending debounced writes when the window goes away so an edit made
// just before quitting isn't lost.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    persistParts.flush()
    persistTemplates.flush()
  })
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  parts: [],
  templates: [],
  loaded: false,

  load: async () => {
    const { parts, templates, isNew } = await window.ww.library.load()
    if (isNew && (parts?.length ?? 0) === 0 && (templates?.length ?? 0) === 0) {
      // First run: populate a small starter library and persist it.
      const seed = seedLibrary()
      set({ parts: seed.parts, templates: seed.templates, loaded: true })
      window.ww.library.saveParts(seed.parts)
      window.ww.library.saveTemplates(seed.templates)
      return
    }
    set({ parts: parts ?? [], templates: templates ?? [], loaded: true })
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
    persistParts.call(parts)
  },

  removePart: (id) => {
    const parts = get().parts.filter((p) => p.id !== id)
    set({ parts })
    persistParts.call(parts)
  },

  upsertTemplate: (template) => {
    const templates = get().templates.slice()
    const i = templates.findIndex((t) => t.id === template.id)
    if (i >= 0) templates[i] = template
    else templates.push(template)
    set({ templates })
    persistTemplates.call(templates)
  },

  removeTemplate: (id) => {
    const templates = get().templates.filter((t) => t.id !== id)
    set({ templates })
    persistTemplates.call(templates)
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
