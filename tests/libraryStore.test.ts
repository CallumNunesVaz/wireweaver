import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLibraryStore, selectLibraryLike } from '../src/stores/libraryStore'
import type { Part, PinoutTemplate } from '../src/model/types'

const wire: Part = {
  id: 'w1',
  kind: 'wire',
  name: 'W',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: ''
}

const tpl: PinoutTemplate = { id: 't1', name: 'T', connectorPartId: 'c1', pins: [] }

const ww = {
  library: {
    saveParts: vi.fn().mockResolvedValue(true),
    saveTemplates: vi.fn().mockResolvedValue(true),
    getPath: vi.fn().mockResolvedValue('/tmp/lib'),
    load: vi.fn(),
    setPath: vi.fn(),
    relocatePath: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ww.library.getPath.mockResolvedValue('/tmp/lib')
  ;(globalThis as unknown as { window: unknown }).window = {
    ww,
    addEventListener: vi.fn()
  }
  useLibraryStore.setState({ parts: [], templates: [], libraryPath: '', loaded: false })
})

describe('libraryStore', () => {
  it('seeds a new empty library on first load', async () => {
    ww.library.load.mockResolvedValue({ parts: [], templates: [], isNew: true })
    await useLibraryStore.getState().load()
    const st = useLibraryStore.getState()
    expect(st.loaded).toBe(true)
    expect(st.parts.length).toBeGreaterThan(0)
    expect(st.libraryPath).toBe('/tmp/lib')
    expect(ww.library.saveParts).toHaveBeenCalled()
    expect(ww.library.saveTemplates).toHaveBeenCalled()
  })

  it('loads an existing library without seeding', async () => {
    ww.library.load.mockResolvedValue({ parts: [wire], templates: [tpl], isNew: false })
    await useLibraryStore.getState().load()
    expect(useLibraryStore.getState().parts).toEqual([wire])
    expect(useLibraryStore.getState().templates).toEqual([tpl])
    expect(ww.library.saveParts).not.toHaveBeenCalled()
  })

  it('upserts new parts with timestamps and updates existing ones', () => {
    useLibraryStore.getState().upsertPart(wire)
    expect(useLibraryStore.getState().parts).toHaveLength(1)
    const created = useLibraryStore.getState().parts[0]
    expect(typeof created.createdAt).toBe('number')
    expect(typeof created.updatedAt).toBe('number')

    useLibraryStore.getState().upsertPart({ ...wire, name: 'W2', createdAt: created.createdAt })
    expect(useLibraryStore.getState().parts).toHaveLength(1)
    expect(useLibraryStore.getState().parts[0].name).toBe('W2')
    expect(useLibraryStore.getState().parts[0].createdAt).toBe(created.createdAt)
  })

  it('removes parts', () => {
    useLibraryStore.getState().upsertPart(wire)
    useLibraryStore.getState().removePart('w1')
    expect(useLibraryStore.getState().parts).toHaveLength(0)
  })

  it('upserts and removes templates', () => {
    useLibraryStore.getState().upsertTemplate(tpl)
    expect(useLibraryStore.getState().templates).toHaveLength(1)
    useLibraryStore.getState().upsertTemplate({ ...tpl, name: 'T2' })
    expect(useLibraryStore.getState().templates).toHaveLength(1)
    expect(useLibraryStore.getState().templates[0].name).toBe('T2')
    useLibraryStore.getState().removeTemplate('t1')
    expect(useLibraryStore.getState().templates).toHaveLength(0)
  })

  it('changes the library path and reloads from it', async () => {
    ww.library.setPath.mockResolvedValue('/new/lib')
    // After switching, the main process reports the new path back to getPath.
    ww.library.getPath.mockResolvedValue('/new/lib')
    ww.library.load.mockResolvedValue({ parts: [wire], templates: [], isNew: false })
    await useLibraryStore.getState().setLibraryPath('/new/lib')
    expect(ww.library.setPath).toHaveBeenCalledWith('/new/lib')
    expect(useLibraryStore.getState().libraryPath).toBe('/new/lib')
    expect(useLibraryStore.getState().parts).toEqual([wire])
  })

  it('relocates the library and reloads', async () => {
    ww.library.relocatePath.mockResolvedValue('/moved')
    ww.library.getPath.mockResolvedValue('/moved')
    ww.library.load.mockResolvedValue({ parts: [], templates: [], isNew: false })
    await useLibraryStore.getState().relocateLibrary('/moved')
    expect(ww.library.relocatePath).toHaveBeenCalledWith('/moved')
    expect(useLibraryStore.getState().libraryPath).toBe('/moved')
  })

  it('selectLibraryLike builds id-keyed records', () => {
    const like = selectLibraryLike({ parts: [wire], templates: [tpl] })
    expect(like.parts.w1).toEqual(wire)
    expect(like.templates.t1).toEqual(tpl)
    expect(selectLibraryLike({ parts: [], templates: [] })).toEqual({ parts: {}, templates: {} })
  })
})
