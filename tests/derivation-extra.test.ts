import { describe, it, expect } from 'vitest'
import {
  resolveAllEndpoints,
  resolveEndpoint,
  pruneInstanceFromHarness,
  suggestHarnessNames,
  validateHarness
} from '../src/model/derivation'
import type {
  ConnectorPart,
  DeviceInstance,
  DevicePart,
  Harness,
  PinoutTemplate
} from '../src/model/types'
import { lib, instances, harness } from './fixtures'

describe('resolveAllEndpoints', () => {
  it('keys resolved endpoints by label and lists missing ones', () => {
    const h: Harness = {
      ...harness,
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'i2', portId: 'portA' },
        { deviceInstanceId: 'missing', portId: 'portA' }
      ]
    }
    const { resolved, missing } = resolveAllEndpoints(lib, instances, h)
    expect([...resolved.keys()]).toEqual(['a', 'b'])
    expect(missing).toEqual(['c'])
  })
})

describe('resolveEndpoint mating connector', () => {
  const female: ConnectorPart = { ...lib.parts.conn1, id: 'cF', gender: 'female' } as ConnectorPart
  const male: ConnectorPart = {
    ...(lib.parts.conn1 as ConnectorPart),
    id: 'cM',
    gender: 'male',
    matingConnectorPartId: 'cF'
  }
  const tpl: PinoutTemplate = {
    id: 'tplM',
    name: 'Mating',
    connectorPartId: 'cM',
    pins: [{ position: 1, signal: 'A' }]
  }
  const dev: DevicePart = {
    ...(lib.parts.dev1 as DevicePart),
    id: 'devM',
    ports: [{ id: 'p', name: 'P', pinoutTemplateId: 'tplM', side: 'right' }]
  }
  const inst: DeviceInstance[] = [{ id: 'i', partId: 'devM', label: 'D', position: { x: 0, y: 0 } }]
  const matingLib = {
    parts: { cM: male, cF: female, devM: dev },
    templates: { tplM: tpl }
  }

  it('resolves the connector and its mating part', () => {
    const re = resolveEndpoint(matingLib, inst, { deviceInstanceId: 'i', portId: 'p' })
    expect(re?.connector?.id).toBe('cM')
    expect(re?.matingConnector?.id).toBe('cF')
  })
})

describe('validateHarness resolution failures', () => {
  it('is invalid when fewer than two endpoints resolve', () => {
    const h: Harness = {
      ...harness,
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'missing', portId: 'portA' }
      ]
    }
    const v = validateHarness(lib, instances, h)
    expect(v.status).toBe('invalid')
    expect(v.warnings.join(' ')).toContain('Less than 2')
  })
})

describe('pruneInstanceFromHarness with splices', () => {
  it('drops splices that fall below two surviving wires', () => {
    const h: Harness = {
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
      segments: [],
      splices: [
        { id: 's1', name: 'S1', wireIds: ['w1', 'w2'] },
        { id: 's2', name: 'S2', wireIds: ['w1', 'w3'] }
      ]
    }
    const pruned = pruneInstanceFromHarness(h, 'i1')!
    // Only w2 survives, so neither splice keeps two wires.
    expect(pruned.wires).toHaveLength(1)
    expect(pruned.splices).toEqual([])
  })

  it('keeps splices whose wires both survive', () => {
    const h: Harness = {
      id: 'h1',
      name: 'trunk',
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'i2', portId: 'portA' },
        { deviceInstanceId: 'i3', portId: 'portA' }
      ],
      wires: [
        { id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
        { id: 'w2', from: { end: 'a', position: 2 }, to: { end: 'b', position: 2 } },
        { id: 'w3', from: { end: 'b', position: 3 }, to: { end: 'c', position: 3 } }
      ],
      segments: [],
      splices: [{ id: 's1', name: 'S1', wireIds: ['w1', 'w2'] }]
    }
    const pruned = pruneInstanceFromHarness(h, 'i3')!
    expect(pruned.splices).toHaveLength(1)
    expect(pruned.splices![0].wireIds.sort()).toEqual(['w1', 'w2'])
  })
})

describe('suggestHarnessNames', () => {
  it('falls back to ?? for unknown instance ids', () => {
    expect(suggestHarnessNames(instances, ['i1', 'nope'])).toBe('FC #1–??')
  })
})
