import { describe, it, expect } from 'vitest'
import { importWireViz } from '../src/model/wireviz-import'
import type { ConnectorPart, WirePart } from '../src/model/types'
import { lib } from './fixtures'

const yaml = `
connectors:
  X1:
    type: Molex Micro-Fit
    pincount: 3
    pins: [1, 2, 3]
    mpn: 43025-0300
  X2:
    type: Molex Micro-Fit
    pins: [1, 2]
cables:
  C1:
    gauge: 22
    colors: [RD, BK]
    wirecount: 2
`

describe('importWireViz', () => {
  it('imports connectors with their position count and MPN', () => {
    const res = importWireViz(yaml, { parts: {}, templates: {} })
    const connectors = res.parts.filter((p) => p.kind === 'connector') as ConnectorPart[]
    expect(connectors).toHaveLength(2)
    const x1 = connectors.find((c) => c.manufacturerPartNumber === '43025-0300')!
    expect(x1.positions).toBe(3)
    expect(x1.name).toBe('Molex Micro-Fit')
  })

  it('creates a template per connector, sized from its pins', () => {
    const res = importWireViz(yaml, { parts: {}, templates: {} })
    expect(res.templates).toHaveLength(2)
    const threePin = res.templates.find((t) => t.pins.length === 3)!
    expect(threePin.pins.map((p) => p.position)).toEqual([1, 2, 3])
    expect(threePin.pins.every((p) => p.signal === '')).toBe(true)
  })

  it('imports cables as wire parts with mm² gauge and shield flag', () => {
    const res = importWireViz(
      `cables:\n  C1:\n    gauge: 22\n    colors: [RD]\n    wirecount: 1\n    shield: true\n`,
      { parts: {}, templates: {} }
    )
    const wire = res.parts.find((p) => p.kind === 'wire') as WirePart
    expect(wire.gauge).toBe('22 mm²')
    expect(wire.shield).toBe(true)
  })

  it('returns empty results for unparseable YAML', () => {
    expect(importWireViz('{ ', { parts: {}, templates: {} })).toEqual({
      parts: [],
      templates: []
    })
  })

  it('never returns parts already present in the library', () => {
    const res = importWireViz(yaml, lib)
    expect(res.parts.every((p) => !lib.parts[p.id])).toBe(true)
  })
})
