/** Regressions for the P0 findings in docs/reviews/2026-11-15-wave2-comprehensive.md. */
import { describe, it, expect } from 'vitest'
import { buildBom } from '../src/model/bom'
import { cutlist, netlist } from '../src/model/reports'
import { assignWirePart, planCableDeploy } from '../src/model/wiring'
import { resolveAllEndpoints } from '../src/model/derivation'
import { parseProjectFile } from '../src/model/project-file'
import * as api from '../src/model/api'
import { bundlePart, clone, harness, instances, lib, parts, project, template } from './fixtures'
import type { HarnessWire, Project } from '../src/model/types'

const withWires = (wires: HarnessWire[], extra: Partial<Project['harnesses'][0]> = {}): Project => {
  const p = clone(project)
  p.harnesses = [{ ...clone(harness), wires, ...extra }]
  return p
}

describe('multi-conductor cables count once', () => {
  const r = resolveAllEndpoints(lib, instances, harness).resolved
  const strands = planCableDeploy({ label: 'a', endpoint: r.get('a')! }, { label: 'b', endpoint: r.get('b')! }, [], bundlePart)

  it('a 4-core cable laid once is one BOM unit and one cut', () => {
    expect(strands).toHaveLength(4)
    expect(new Set(strands.map((s) => s.cableId)).size).toBe(1)
    const p = withWires(strands)
    expect(buildBom(p, lib).find((x) => x.name === bundlePart.name)?.quantity).toBe(1)
    const cuts = cutlist(lib, p).filter((x) => x.wirePart === bundlePart.name)
    expect(cuts.reduce((n, x) => n + x.quantity, 0)).toBe(1)
  })

  it('two cables laid are two units', () => {
    const p = withWires([...strands, ...strands.map((s) => ({ ...s, id: s.id + 'x', cableId: 'other' }))])
    expect(buildBom(p, lib).find((x) => x.name === bundlePart.name)?.quantity).toBe(2)
  })

  it('older projects without cable ids group conductors by endpoint pair', () => {
    const legacy = strands.map(({ cableId: _c, ...w }) => w)
    expect(buildBom(withWires(legacy), lib).find((x) => x.name === bundlePart.name)?.quantity).toBe(1)
  })

  it('assigning conductors one by one fills one cable', () => {
    let wires: HarnessWire[] = clone(harness.wires)
    wires = assignWirePart(wires, 'w1', bundlePart)
    wires = assignWirePart(wires, 'w2', bundlePart)
    expect(wires[0].cableId).toBeDefined()
    expect(wires[0].cableId).toBe(wires[1].cableId)
    expect(buildBom(withWires(wires), lib).find((x) => x.name === bundlePart.name)?.quantity).toBe(1)
  })
})

describe('netlist and splices', () => {
  it('wires joined at a splice form one net', () => {
    const wires: HarnessWire[] = [
      { id: 'x1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
      { id: 'x2', from: { end: 'a', position: 2 }, to: { end: 'b', position: 2 } }
    ]
    expect(netlist(lib, withWires(wires)).length).toBe(2)
    const spliced = withWires(wires, { splices: [{ id: 's', name: 'Splice 1', wireIds: ['x1', 'x2'] }] })
    expect(netlist(lib, spliced).length).toBe(1)
  })
})

describe('one port, one harness — API', () => {
  it('createHarness rejects a port that already belongs to a harness', () => {
    const snaps = { partSnapshots: Object.fromEntries(parts.map((p) => [p.id, p])), templateSnapshots: { tpl1: template } }
    const ws = api.loadWorkspace(clone({ ...project, ...snaps }))
    expect(() =>
      api.createHarness(ws, { name: 'Again', endpoints: [{ deviceInstanceId: 'i1', portId: 'portA' }, { deviceInstanceId: 'i3', portId: 'portA' }] })
    ).toThrow(/already belongs to harness/)
  })
})

describe('project file validation', () => {
  it('drops malformed snapshots and revisions instead of failing the file', () => {
    const p = parseProjectFile({
      ...clone(project),
      partSnapshots: { dev1: parts[1], bad: { id: 'bad', kind: 'device', name: 'No ports' }, wrongKey: parts[0] },
      revisions: [
        { id: 'ok', label: 'OK', timestamp: 1, project: clone(project) },
        { id: 'broken', label: 'Broken', timestamp: 2, project: { nonsense: true } }
      ]
    })
    expect(Object.keys(p.partSnapshots)).toEqual(['dev1'])
    expect(p.revisions.map((r) => r.id)).toEqual(['ok'])
  })
})
