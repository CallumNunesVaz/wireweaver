import { describe, it, expect } from 'vitest'
import { generateFormboardLayout } from '../src/model/formboard'
import { autoLayout } from '../src/assembly/autoLayout'
import { harness, lib, project, instances, clone } from './fixtures'

describe('generateFormboardLayout', () => {
  it('places endpoints at their segment distances from the origin', () => {
    const nodes = generateFormboardLayout(harness, lib, project.deviceInstances)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.label === 'FC #1')!
    const b = nodes.find((n) => n.label === 'FC #2')!
    expect(a).toMatchObject({ x: 0, y: 0, length: 0 })
    // The fixture's a–b segment is 250 mm, and the formboard is 1 mm = 1 px.
    expect(b.x).toBe(250)
    expect(b.y).toBe(0)
    expect(b.length).toBe(250)
  })

  it('includes the connector name for each endpoint', () => {
    const nodes = generateFormboardLayout(harness, lib, project.deviceInstances)
    expect(nodes.every((n) => n.connectorName === 'JST GH 4-pos')).toBe(true)
  })

  it('falls back to a separated layout when wires have no segment', () => {
    const noSeg = clone(harness)
    noSeg.segments = []
    const nodes = generateFormboardLayout(noSeg, lib, project.deviceInstances)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.label === 'FC #1')!
    const b = nodes.find((n) => n.label === 'FC #2')!
    expect(a.x).toBe(0)
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.length).toBe(0)
  })

  it('returns nothing for a harness with no endpoints', () => {
    expect(generateFormboardLayout({ ...harness, endpoints: [] }, lib, instances)).toEqual([])
  })
})

describe('autoLayout', () => {
  it('lays out connected nodes left to right', () => {
    const pos = autoLayout([instances[0], instances[1]], [harness])
    expect(Object.keys(pos).sort()).toEqual(['i1', 'i2'])
    expect(pos.i2.x).toBeGreaterThan(pos.i1.x)
  })

  it('still positions unconnected nodes', () => {
    const pos = autoLayout([instances[0], instances[1]], [])
    expect(pos.i1).toBeDefined()
    expect(pos.i2).toBeDefined()
    expect(Number.isFinite(pos.i1.x)).toBe(true)
  })

  it('ignores harness endpoints referencing unknown instances', () => {
    const ghost = { ...harness, endpoints: [{ deviceInstanceId: 'ghost', portId: 'p' }, ...harness.endpoints] }
    const pos = autoLayout([instances[0], instances[1]], [ghost])
    expect(Object.keys(pos).sort()).toEqual(['i1', 'i2'])
  })
})
