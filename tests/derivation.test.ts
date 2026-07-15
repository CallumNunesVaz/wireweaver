import { describe, it, expect } from 'vitest'
import {
  resolveEndpoint,
  validateHarness,
  suggestHarnessNames,
  pruneInstanceFromHarness,
  sanitizeTwists,
  type LibraryLike
} from '../src/model/derivation'
import type {
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  Harness,
  PinoutTemplate
} from '../src/model/types'

const connector: ConnectorPart = {
  id: 'conn1',
  kind: 'connector',
  name: 'JST GH 4-pos',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: '',
  positions: 4
}

const template: PinoutTemplate = {
  id: 'tpl1',
  name: 'CAN + Power',
  connectorPartId: 'conn1',
  pins: [
    { position: 1, signal: '5V', signalClass: 'power' },
    { position: 2, signal: 'CAN_H', signalClass: 'data' },
    { position: 3, signal: 'CAN_L', signalClass: 'data' },
    { position: 4, signal: 'GND', signalClass: 'ground' }
  ]
}

const device: DevicePart = {
  id: 'dev1',
  kind: 'device',
  name: 'Flight Controller',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: '',
  ports: [{ id: 'portA', name: 'CAN A', pinoutTemplateId: 'tpl1', side: 'right' }]
}

const lib: LibraryLike = {
  parts: { conn1: connector, dev1: device },
  templates: { tpl1: template }
}

const instances: DeviceInstance[] = [
  { id: 'i1', partId: 'dev1', label: 'FC #1', position: { x: 0, y: 0 } },
  { id: 'i2', partId: 'dev1', label: 'FC #2', position: { x: 300, y: 0 } }
]

describe('resolveEndpoint', () => {
  it('derives connector and pins from a port (never stored on harness)', () => {
    const re = resolveEndpoint(lib, instances, {
      deviceInstanceId: 'i1',
      portId: 'portA'
    })
    expect(re?.connector?.name).toBe('JST GH 4-pos')
    expect(re?.pins).toHaveLength(4)
  })

  it('returns undefined for a missing instance', () => {
    expect(
      resolveEndpoint(lib, instances, { deviceInstanceId: 'nope', portId: 'portA' })
    ).toBeUndefined()
  })
})

describe('validateHarness', () => {
  const base: Harness = {
    id: 'h1',
    name: 'FC1-FC2',
    endpoints: [
      { deviceInstanceId: 'i1', portId: 'portA' },
      { deviceInstanceId: 'i2', portId: 'portA' }
    ],
    wires: [],
    segments: []
  }

  it('reports unwired with no wires', () => {
    expect(validateHarness(lib, instances, base).status).toBe('unwired')
  })

  it('reports wired when all pins are connected straight-through', () => {
    const wires = [1, 2, 3, 4].map((p) => ({
      id: `w${p}`,
      from: { end: 'a', position: p },
      to: { end: 'b', position: p }
    }))
    const v = validateHarness(lib, instances, { ...base, wires })
    expect(v.status).toBe('wired')
    expect(v.wireCount).toBe(4)
  })

  it('warns on signal-class mismatch', () => {
    const v = validateHarness(lib, instances, {
      ...base,
      wires: [{ id: 'w', from: { end: 'a', position: 1 }, to: { end: 'b', position: 4 } }]
    })
    expect(v.warnings.some((w) => w.includes('mismatch'))).toBe(true)
  })

  it('flags orphan wires referencing non-existent pins', () => {
    const v = validateHarness(lib, instances, {
      ...base,
      wires: [{ id: 'w', from: { end: 'a', position: 9 }, to: { end: 'b', position: 1 } }]
    })
    expect(v.status).toBe('invalid')
    expect(v.orphanWireIds).toContain('w')
  })

  it('counts multi-conductor strands between the same pins as one connection', () => {
    // A 4-core bundle assigned to one pin pair creates 4 parallel strands;
    // that must not read as a fully wired harness.
    const wires = [1, 2, 3, 4].map((n) => ({
      id: `s${n}`,
      from: { end: 'a', position: 1 },
      to: { end: 'b', position: 1 },
      wirePartId: 'bundle'
    }))
    const v = validateHarness(lib, instances, { ...base, wires })
    expect(v.wireCount).toBe(1)
    expect(v.status).toBe('partial')
  })
})

describe('pruneInstanceFromHarness', () => {
  const threeWay: Harness = {
    id: 'h1',
    name: 'trunk',
    endpoints: [
      { deviceInstanceId: 'i1', portId: 'portA' },
      { deviceInstanceId: 'i2', portId: 'portA' },
      { deviceInstanceId: 'i3', portId: 'portA' }
    ],
    wires: [
      { id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
      { id: 'w2', from: { end: 'b', position: 2 }, to: { end: 'c', position: 2 } },
      { id: 'w3', from: { end: 'a', position: 3 }, to: { end: 'c', position: 3 } }
    ],
    segments: [
      { fromEnd: 'a', toEnd: 'b', lengthMm: 100 },
      { fromEnd: 'b', toEnd: 'c', lengthMm: 200 }
    ]
  }

  it('returns the harness unchanged when the instance is not an endpoint', () => {
    expect(pruneInstanceFromHarness(threeWay, 'other')).toBe(threeWay)
  })

  it('drops wires/segments touching the removed endpoint and remaps labels', () => {
    const pruned = pruneInstanceFromHarness(threeWay, 'i1')!
    expect(pruned.endpoints.map((e) => e.deviceInstanceId)).toEqual(['i2', 'i3'])
    // old b→a, old c→b; w1/w3 touched removed 'a' and are gone, w2 remapped.
    expect(pruned.wires).toHaveLength(1)
    expect(pruned.wires[0]).toMatchObject({
      from: { end: 'a', position: 2 },
      to: { end: 'b', position: 2 }
    })
    expect(pruned.segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 200 }])
  })

  it('returns null when fewer than two endpoints remain', () => {
    const twoWay: Harness = { ...threeWay, endpoints: threeWay.endpoints.slice(0, 2) }
    expect(pruneInstanceFromHarness(twoWay, 'i1')).toBeNull()
  })

  it('remaps editor layout positions to the shifted labels', () => {
    const withLayout: Harness = {
      ...threeWay,
      layout: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 0, y: 300 } }
    }
    const pruned = pruneInstanceFromHarness(withLayout, 'i1')!
    // old b→a, old c→b; old a's position is dropped with its endpoint.
    expect(pruned.layout).toEqual({ a: { x: 100, y: 0 }, b: { x: 0, y: 300 } })
  })
})

describe('sanitizeTwists', () => {
  it('clears twistedWith pointing at removed wires and keeps valid pairs', () => {
    const wires = [
      { id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 }, twistedWith: 'gone' },
      { id: 'w2', from: { end: 'a', position: 2 }, to: { end: 'b', position: 2 }, twistedWith: 'w3' },
      { id: 'w3', from: { end: 'a', position: 3 }, to: { end: 'b', position: 3 }, twistedWith: 'w2' }
    ]
    const out = sanitizeTwists(wires)
    expect(out[0].twistedWith).toBeUndefined()
    expect(out[1].twistedWith).toBe('w3')
    expect(out[2].twistedWith).toBe('w2')
  })
})

describe('suggestHarnessNames', () => {
  it('joins the instance labels', () => {
    expect(suggestHarnessNames(instances, ['i1', 'i2'])).toBe('FC #1–FC #2')
  })
})
