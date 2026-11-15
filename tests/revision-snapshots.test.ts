import { describe, it, expect } from 'vitest'
import * as api from '../src/model/api'
import { createRevision } from '../src/model/revisions'
import { withSnapshots } from '../src/model/snapshot'
import {
  parseProjectFile,
  serializeProjectFile,
  PROJECT_SCHEMA_VERSION
} from '../src/model/project-file'
import { buildEffectiveLibrary } from '../src/stores/effectiveLibrary'
import type { Project, WirePart } from '../src/model/types'

const wirePart = (id: string, name?: string): WirePart => ({
  id,
  kind: 'wire',
  name: name ?? `W${id}`,
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: ''
})

function projectWithWires(wireIds: string[], id = 'p'): Project {
  return {
    id,
    name: 'Size test',
    deviceInstances: [
      { id: 'i1', partId: 'dev1', label: 'A', position: { x: 0, y: 0 } },
      { id: 'i2', partId: 'dev1', label: 'B', position: { x: 100, y: 0 } }
    ],
    harnesses: [
      {
        id: 'h1',
        name: 'H',
        endpoints: [
          { deviceInstanceId: 'i1', portId: 'pA' },
          { deviceInstanceId: 'i2', portId: 'pA' }
        ],
        wires: wireIds.map((wid, i) => ({
          id: `w${i}`,
          from: { end: 'a', position: i + 1 },
          to: { end: 'b', position: i + 1 },
          wirePartId: wid
        })),
        segments: [],
        accessories: [],
        splices: []
      }
    ],
    partSnapshots: {},
    templateSnapshots: {},
    revisions: []
  }
}

describe('revision snapshot sharing', () => {
  it('does not duplicate snapshot maps across revisions and shrinks the file', () => {
    const nParts = 50
    const nRevs = 20
    const ids = Array.from({ length: nParts }, (_, i) => `wp${i}`)
    const parts = ids.map((id) => wirePart(id))

    let project = withSnapshots(projectWithWires(ids, 'big'), parts, [])
    for (let i = 0; i < nRevs; i++) {
      project = { ...project, revisions: [...project.revisions, createRevision(project, `R${i}`)] }
    }

    const disk = serializeProjectFile(project)
    expect(disk.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(Object.keys(disk.partSnapshots)).toHaveLength(nParts)
    for (const r of disk.revisions) {
      expect((r.project as { partSnapshots?: unknown }).partSnapshots).toBeUndefined()
      expect((r.project as { templateSnapshots?: unknown }).templateSnapshots).toBeUndefined()
    }

    const newBytes = JSON.stringify(disk).length

    // Reconstruct the v2 shape, where every revision carried its own copy of
    // the snapshot maps, to measure the size it would have taken before.
    const oldDisk = {
      ...disk,
      revisions: disk.revisions.map((r) => ({
        ...r,
        project: {
          ...r.project,
          partSnapshots: disk.partSnapshots,
          templateSnapshots: disk.templateSnapshots
        }
      }))
    }
    const oldBytes = JSON.stringify(oldDisk).length

    // Surface the numbers for the record.
    console.log(`revision snapshots: ${oldBytes} bytes (old) -> ${newBytes} bytes (new)`)

    expect(newBytes).toBeLessThan(oldBytes)
  })

  it('round-trips v3 with revisions sharing top-level snapshots', () => {
    const parts = [wirePart('wp1'), wirePart('wp2')]
    let project = withSnapshots(projectWithWires(['wp1', 'wp2'], 'rt'), parts, [])
    project = { ...project, revisions: [...project.revisions, createRevision(project, 'R1')] }

    const disk = serializeProjectFile(project)
    const back = parseProjectFile(JSON.parse(JSON.stringify(disk)))
    expect(back.revisions).toHaveLength(1)
    expect(back.partSnapshots.wp1).toBeDefined()
    expect(back.partSnapshots.wp2).toBeDefined()
    expect(back.revisions[0].project).not.toHaveProperty('partSnapshots')
    expect(back.revisions[0].project).not.toHaveProperty('templateSnapshots')

    // Serializing again (with the same library) stays lossless.
    const disk2 = serializeProjectFile(withSnapshots(back, parts, []))
    const back2 = parseProjectFile(JSON.parse(JSON.stringify(disk2)))
    expect(Object.keys(back2.partSnapshots).sort()).toEqual(['wp1', 'wp2'])
    expect(back2.revisions).toHaveLength(1)
  })

  it('migrates a v2 file by hoisting revision snapshots to the top level', () => {
    const v2 = {
      schemaVersion: 2,
      id: 'p',
      name: 'V2',
      deviceInstances: [],
      harnesses: [],
      partSnapshots: { keep: wirePart('keep', 'top-level') },
      templateSnapshots: {},
      revisions: [
        {
          id: 'r1',
          timestamp: 1,
          label: 'R1',
          project: {
            id: 'p',
            name: 'V2',
            deviceInstances: [],
            harnesses: [],
            partSnapshots: {
              keep: wirePart('keep', 'revision-copy'),
              hoisted: wirePart('hoisted')
            },
            templateSnapshots: {}
          }
        }
      ]
    }

    const parsed = parseProjectFile(v2)
    expect(parsed.partSnapshots.hoisted.id).toBe('hoisted')
    // Top-level entries win on id conflicts.
    expect(parsed.partSnapshots.keep.name).toBe('top-level')
    expect(parsed.revisions).toHaveLength(1)
    expect(parsed.revisions[0].project).not.toHaveProperty('partSnapshots')
    expect(parsed.revisions[0].project).not.toHaveProperty('templateSnapshots')
  })

  it('restoring a revision still resolves parts deleted from the library via snapshots', () => {
    const ws = api.createWorkspace('Restore')
    const conn = api.createConnectorPart(ws, { name: 'Conn', positions: 2 })
    const tpl = api.createPinoutTemplate(ws, { name: 'Tpl', connectorPartId: conn.id, pins: [] })
    const dev = api.createDevicePart(ws, {
      name: 'Device',
      ports: [{ name: 'P', pinoutTemplateId: tpl.id, side: 'right' }]
    })
    api.addDevice(ws, { partId: dev.id, label: 'D1' })
    api.addDevice(ws, { partId: dev.id, label: 'D2' })
    const rev = api.createRevision(ws, 'R1')

    const serialized = api.serializeWorkspace(ws)
    const reloaded = api.loadWorkspace(JSON.parse(JSON.stringify(serialized)))

    // Simulate the referenced part being deleted from the local library.
    reloaded.parts = reloaded.parts.filter((p) => p.id !== dev.id)
    reloaded.templates = reloaded.templates.filter((t) => t.id !== tpl.id)

    api.restoreRevision(reloaded, rev.id)

    // The part still resolves because restore keeps the top-level snapshots.
    const eff = buildEffectiveLibrary(reloaded.parts, reloaded.templates, reloaded.project)
    expect(eff.lib.parts[dev.id]).toBeDefined()
    expect(eff.lib.parts[dev.id]!.name).toBe('Device')
    expect(eff.lib.templates[tpl.id]).toBeDefined()
  })
})

describe('part references cover revisions, splices and accessories', () => {
  it('blocks deleting a part used only by a revision, splice or accessory', async () => {
    const { findPartReferences } = await import('../src/model/references')
    const { createRevision } = await import('../src/model/revisions')
    const { project, parts, templates } = await import('./fixtures')
    const p = JSON.parse(JSON.stringify(project))
    p.revisions = [createRevision(p, 'A1')]
    // Remove every current use of the device, leaving only the revision.
    p.deviceInstances = []
    p.harnesses = []
    expect(findPartReferences('dev1', parts, templates, p)).toEqual(['revision “A1”'])

    const q = JSON.parse(JSON.stringify(project))
    q.harnesses[0].wires = []
    q.harnesses[0].splices = [{ id: 's', name: 'Splice 1', wireIds: [], wirePartId: 'wire1' }]
    q.harnesses[0].accessories = [{ id: 'a', partId: 'bundle1', category: 'other', quantity: 1 }]
    expect(findPartReferences('wire1', parts, templates, q)).toEqual(['1 splice'])
    expect(findPartReferences('bundle1', parts, templates, q)).toEqual(['1 harness accessory'])
  })
})
