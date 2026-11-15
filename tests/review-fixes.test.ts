/**
 * Tests for the modules introduced by the review fixes: shared wiring
 * planners, the versioned project/library file format, formula-safe CSV and
 * the effective (library + snapshot) library.
 */
import { describe, it, expect } from 'vitest'
import { resolveAllEndpoints } from '../src/model/derivation'
import {
  assignWirePart,
  nextSpliceName,
  planAutoWire,
  planCableDeploy
} from '../src/model/wiring'
import {
  FileFormatError,
  PROJECT_SCHEMA_VERSION,
  parseLibraryFile,
  parseProjectFile,
  serializeProjectFile
} from '../src/model/project-file'
import { csvCell, csvRow } from '../src/model/csv'
import { buildEffectiveLibrary } from '../src/stores/effectiveLibrary'
import * as api from '../src/model/api'
import { bundlePart, clone, device, harness, instances, lib, parts, project, template, templates, wirePart } from './fixtures'
import type { HarnessWire } from '../src/model/types'

const resolved = () => resolveAllEndpoints(lib, instances, harness).resolved

describe('planAutoWire', () => {
  it('wires matching signals that are still free, skipping wired pins', () => {
    const added = planAutoWire(resolved(), 2, harness.wires)
    // Pins 1 and 4 are already wired in the fixture; 2 and 3 match by name.
    expect(added.map((w) => [w.from.position, w.to.position])).toEqual([
      [2, 2],
      [3, 3]
    ])
    expect(planAutoWire(resolved(), 2, [...harness.wires, ...added])).toEqual([])
  })

  it('backs api.autoWire so the app and MCP server behave identically', () => {
    const ws = api.loadWorkspace(clone({ ...project, partSnapshots: Object.fromEntries(parts.map((p) => [p.id, p])), templateSnapshots: { tpl1: template } }))
    const added = api.autoWire(ws, 'h1')
    expect(added).toHaveLength(2)
  })
})

describe('assignWirePart', () => {
  it('gives a single-conductor part to the wire', () => {
    const next = assignWirePart(harness.wires, 'w1', { ...wirePart, id: 'wx', color: '#00ff00' })
    expect(next.find((w) => w.id === 'w1')).toMatchObject({ wirePartId: 'wx', color: '#00ff00' })
    expect(next).toHaveLength(harness.wires.length)
  })

  it('makes the wire one conductor of a cable instead of stacking strands on one pin', () => {
    let wires: HarnessWire[] = clone(harness.wires)
    wires = assignWirePart(wires, 'w1', bundlePart)
    wires = assignWirePart(wires, 'w2', bundlePart)
    expect(wires).toHaveLength(2)
    const labels = wires.map((w) => w.label)
    expect(new Set(labels).size).toBe(2) // distinct conductor colours
    expect(wires.every((w) => w.wirePartId === bundlePart.id)).toBe(true)
  })
})

describe('planCableDeploy', () => {
  it('lays one conductor per free pin pair, matching signals first, plus the shield', () => {
    const r = resolved()
    const strands = planCableDeploy(
      { label: 'a', endpoint: r.get('a')! },
      { label: 'b', endpoint: r.get('b')! },
      [],
      bundlePart
    )
    // 4 pins per side, 4 conductors: all used, so no free pins remain for a shield.
    expect(strands).toHaveLength(4)
    expect(strands.every((s) => s.from.position === s.to.position)).toBe(true)
  })

  it('never reuses a pin that is already wired', () => {
    const r = resolved()
    const strands = planCableDeploy(
      { label: 'a', endpoint: r.get('a')! },
      { label: 'b', endpoint: r.get('b')! },
      harness.wires,
      bundlePart
    )
    const used = new Set(harness.wires.flatMap((w) => [`a:${w.from.position}`, `b:${w.to.position}`]))
    for (const s of strands) {
      expect(used.has(`a:${s.from.position}`)).toBe(false)
      expect(used.has(`b:${s.to.position}`)).toBe(false)
    }
  })
})

describe('nextSpliceName', () => {
  it('numbers splices sequentially, filling gaps', () => {
    expect(nextSpliceName([])).toBe('Splice 1')
    expect(
      nextSpliceName([
        { id: '1', name: 'Splice 1', wireIds: [] },
        { id: '3', name: 'Splice 3', wireIds: [] }
      ])
    ).toBe('Splice 2')
  })
})

describe('project file format', () => {
  it('stamps the schema version on save and round-trips', () => {
    const disk = serializeProjectFile(project)
    expect(disk.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    const back = parseProjectFile(JSON.parse(JSON.stringify(disk)))
    expect(back.harnesses[0].wires).toHaveLength(2)
    expect(back.deviceInstances).toHaveLength(3)
  })

  it('rejects files from a newer WireWeaver', () => {
    expect(() => parseProjectFile({ ...project, schemaVersion: PROJECT_SCHEMA_VERSION + 1 })).toThrow(FileFormatError)
  })

  it('rejects things that are not projects', () => {
    expect(() => parseProjectFile(null)).toThrow(FileFormatError)
    expect(() => parseProjectFile([1, 2])).toThrow(FileFormatError)
    expect(() => parseProjectFile({ hello: 'world' })).toThrow(FileFormatError)
  })

  it('repairs malformed members instead of crashing a render later', () => {
    const p = parseProjectFile({
      name: 'Broken',
      deviceInstances: [{ id: 'd', partId: 'x' }, { nonsense: true }],
      harnesses: [{ id: 'h', endpoints: [{ deviceInstanceId: 'd', portId: 'p' }, 7], wires: [{ id: 'bad' }] }]
    })
    expect(p.deviceInstances).toEqual([{ id: 'd', partId: 'x', label: 'Device', position: { x: 0, y: 0 } }])
    expect(p.harnesses[0].endpoints).toHaveLength(1)
    expect(p.harnesses[0].wires).toEqual([])
    expect(p.revisions).toEqual([])
  })

  it('validates library files', () => {
    expect(parseLibraryFile({ parts: [device], templates }).parts).toHaveLength(1)
    expect(() => parseLibraryFile({ parts: [], templates: [] })).toThrow(FileFormatError)
    expect(() => parseLibraryFile('nope')).toThrow(FileFormatError)
  })
})

describe('csvCell', () => {
  it('neutralises spreadsheet formula prefixes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('leaves numbers and plain text alone, and quotes separators', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('JST GH')).toBe('JST GH')
    expect(csvRow(['a,b', 1, undefined])).toBe('"a,b",1,')
  })
})

describe('buildEffectiveLibrary', () => {
  it('fills gaps from project snapshots while library entries win', () => {
    const renamed = { ...device, name: 'Library FC' }
    const eff = buildEffectiveLibrary([renamed], [], {
      partSnapshots: { dev1: device, conn1: parts[0] },
      templateSnapshots: { tpl1: template }
    })
    expect(eff.lib.parts.dev1.name).toBe('Library FC')
    expect(eff.lib.parts.conn1).toBeDefined()
    expect(eff.lib.templates.tpl1).toBeDefined()
    expect([...eff.snapshotOnly].sort()).toEqual(['conn1', 'tpl1'])
  })

  it('is memoised on its inputs', () => {
    const snaps = { partSnapshots: {}, templateSnapshots: {} }
    const a = buildEffectiveLibrary(parts, templates, snaps)
    expect(buildEffectiveLibrary(parts, templates, snaps)).toBe(a)
  })
})
