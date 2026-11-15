import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyChanges, loadLibrary } from '../electron/main/libraryStorage'
import type { Part, PinoutTemplate } from '../src/model/types'

const part = (id: string, name = 'P'): Part => ({
  id,
  kind: 'wire',
  name,
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: ''
})

const template = (id: string, name = 'T'): PinoutTemplate => ({
  id,
  name,
  connectorPartId: 'c1',
  pins: []
})

const empty = { removePartIds: [], removeTemplateIds: [] }

async function tempDir(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), 'ww-libstore-'))
}

describe('libraryStorage', () => {
  it('round-trips parts and templates as per-record files', async () => {
    const dir = await tempDir()
    try {
      await applyChanges(dir, {
        upsertParts: [part('a'), part('b')],
        upsertTemplates: [template('t')],
        ...empty
      })
      const loaded = await loadLibrary(dir)
      expect(loaded.isNew).toBe(false)
      expect(loaded.error).toBeUndefined()
      expect(loaded.parts.map((p) => p.id).sort()).toEqual(['a', 'b'])
      expect(loaded.templates.map((t) => t.id)).toEqual(['t'])
      expect((await fs.readdir(join(dir, 'parts'))).sort()).toEqual(['a.json', 'b.json'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('hashes unsafe ids for the filename but keeps the real id in the record', async () => {
    const dir = await tempDir()
    try {
      const badId = 'part id / with spaces'
      await applyChanges(dir, { upsertParts: [part(badId, 'X')], upsertTemplates: [], ...empty })
      const files = await fs.readdir(join(dir, 'parts'))
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/)
      const loaded = await loadLibrary(dir)
      expect(loaded.parts).toHaveLength(1)
      expect(loaded.parts[0].id).toBe(badId)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('removes a record', async () => {
    const dir = await tempDir()
    try {
      await applyChanges(dir, { upsertParts: [part('a')], upsertTemplates: [], ...empty })
      await applyChanges(dir, { upsertParts: [], upsertTemplates: [], removePartIds: ['a'], removeTemplateIds: [] })
      const loaded = await loadLibrary(dir)
      expect(loaded.parts).toHaveLength(0)
      expect((await fs.readdir(join(dir, 'parts')))).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('migrates legacy whole-file stores once and renames them aside', async () => {
    const dir = await tempDir()
    try {
      await fs.writeFile(join(dir, 'parts.json'), JSON.stringify([part('a'), part('b')]))
      await fs.writeFile(join(dir, 'pinout-templates.json'), JSON.stringify([template('t')]))
      const loaded = await loadLibrary(dir)
      expect(loaded.error).toBeUndefined()
      expect(loaded.isNew).toBe(false)
      expect(loaded.parts.map((p) => p.id).sort()).toEqual(['a', 'b'])
      expect(loaded.templates.map((t) => t.id)).toEqual(['t'])
      const root = await fs.readdir(dir)
      expect(root).not.toContain('parts.json')
      expect(root).not.toContain('pinout-templates.json')
      expect(root.some((f) => f.startsWith('parts.json.migrated-'))).toBe(true)
      expect(root.some((f) => f.startsWith('pinout-templates.json.migrated-'))).toBe(true)
      expect((await fs.readdir(join(dir, 'parts'))).sort()).toEqual(['a.json', 'b.json'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('quarantines a corrupt record and still loads the rest', async () => {
    const dir = await tempDir()
    try {
      await applyChanges(dir, { upsertParts: [part('a'), part('b')], upsertTemplates: [], ...empty })
      await fs.writeFile(join(dir, 'parts', 'bad.json'), '{ not json')
      const loaded = await loadLibrary(dir)
      expect(loaded.error).toBeDefined()
      expect(loaded.parts.map((p) => p.id).sort()).toEqual(['a', 'b'])
      const files = await fs.readdir(join(dir, 'parts'))
      expect(files.filter((f) => f.endsWith('.json')).sort()).toEqual(['a.json', 'b.json'])
      expect(files.some((f) => f.startsWith('bad.json.corrupt-'))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not lose writes when applyChanges is called concurrently', async () => {
    const dir = await tempDir()
    try {
      await Promise.all([
        applyChanges(dir, { upsertParts: [part('a')], upsertTemplates: [], ...empty }),
        applyChanges(dir, { upsertParts: [part('b')], upsertTemplates: [], ...empty }),
        applyChanges(dir, { upsertParts: [part('c')], upsertTemplates: [], ...empty })
      ])
      const loaded = await loadLibrary(dir)
      expect(loaded.parts.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a fresh directory as new', async () => {
    const dir = await tempDir()
    try {
      const loaded = await loadLibrary(dir)
      expect(loaded.isNew).toBe(true)
      expect(loaded.parts).toEqual([])
      expect(loaded.templates).toEqual([])
      expect(loaded.error).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
