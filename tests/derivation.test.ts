import { describe, it, expect } from 'vitest'
import {
  resolveEndpoint,
  validateHarness,
  suggestHarnessName,
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
    a: { deviceInstanceId: 'i1', portId: 'portA' },
    b: { deviceInstanceId: 'i2', portId: 'portA' },
    wires: []
  }

  it('reports unwired with no wires', () => {
    expect(validateHarness(lib, instances, base).status).toBe('unwired')
  })

  it('reports wired when all pins are connected straight-through', () => {
    const wires = [1, 2, 3, 4].map((p) => ({
      id: `w${p}`,
      from: { end: 'a' as const, position: p },
      to: { end: 'b' as const, position: p }
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
})

describe('suggestHarnessName', () => {
  it('joins the two instance labels', () => {
    expect(suggestHarnessName(instances, 'i1', 'i2')).toBe('FC #1–FC #2')
  })
})
