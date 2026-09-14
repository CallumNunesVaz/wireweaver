import { describe, it, expect } from 'vitest'
import {
  bundleLabels,
  bundleLabelsCsv,
  cutlist,
  cutlistCsv,
  netlist,
  netlistCsv,
  wiringCsv,
  wiringTable
} from '../src/model/reports'
import { lib, project, harness, clone } from './fixtures'

describe('bundle labels', () => {
  it('numbers each endpoint pair uniquely, normalising direction', () => {
    const h = clone(harness)
    h.segments = [
      { fromEnd: 'a', toEnd: 'b', lengthMm: 100 },
      { fromEnd: 'b', toEnd: 'a', lengthMm: 120 },
      { fromEnd: 'b', toEnd: 'c', lengthMm: 80 }
    ]
    expect(bundleLabels(h).map((l) => l.label)).toEqual(['A-B-1', 'A-B-2', 'B-C-1'])
  })

  it('serialises to a label-printer CSV', () => {
    const csv = bundleLabelsCsv([
      { label: 'A-B-1', fromEnd: 'a', toEnd: 'b', lengthMm: 100 }
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Label,From,To,Length')
    expect(lines[1]).toBe('A-B-1,a,b,100')
  })
})

describe('CSV serialisers', () => {
  it('writes a netlist header and rows', () => {
    const csv = netlistCsv(netlist(lib, project))
    expect(csv.split('\n')[0]).toBe('Net,Device,Port,Pin,Signal')
    expect(csv).toContain('GND')
  })

  it('marks unknown cut lengths', () => {
    const noSeg = clone(harness)
    noSeg.segments = []
    const csv = cutlistCsv(cutlist(lib, { ...clone(project), harnesses: [noSeg] }, 0))
    expect(csv).toContain('unknown')
  })

  it('includes the twisted-with column in the wiring table', () => {
    const h = clone(harness)
    h.wires[0].twistedWith = 'w2'
    h.wires[1].twistedWith = 'w1'
    const csv = wiringCsv(wiringTable(lib, { ...clone(project), harnesses: [h] }, h))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Twisted With')
    expect(lines[1]).toContain('GND-LINK')
  })
})
