import { describe, it, expect } from 'vitest'
import type { LibraryLike } from '../src/model/derivation'
import type {
  ConnectorPart,
  DevicePart,
  Harness,
  PinoutTemplate,
  Project,
  WirePart
} from '../src/model/types'
import {
  cutlist,
  cutlistCsv,
  netlist,
  wireLabels,
  wiringCsv,
  wiringTable
} from '../src/model/reports'
import { runDrc } from '../src/model/drc'
import { wirevizYaml } from '../src/model/wireviz'

const connector: ConnectorPart = {
  id: 'conn1',
  kind: 'connector',
  name: 'JST GH 4-pos',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: 'GHR-04V-S',
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

const hookup: WirePart = {
  id: 'wire1',
  kind: 'wire',
  name: 'Hookup 22AWG',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: '',
  gauge: '22 AWG',
  color: 'RD'
}

const lib: LibraryLike = {
  parts: { conn1: connector, dev1: device, wire1: hookup },
  templates: { tpl1: template }
}

const harness: Harness = {
  id: 'h1',
  name: 'FC1-FC2',
  endpoints: [
    { deviceInstanceId: 'i1', portId: 'portA' },
    { deviceInstanceId: 'i2', portId: 'portA' }
  ],
  wires: [
    {
      id: 'w1',
      from: { end: 'a', position: 1 },
      to: { end: 'b', position: 1 },
      wirePartId: 'wire1',
      color: 'RD'
    },
    {
      id: 'w2',
      from: { end: 'a', position: 4 },
      to: { end: 'b', position: 4 },
      wirePartId: 'wire1',
      color: 'BK',
      label: 'GND-LINK'
    }
  ],
  segments: [{ fromEnd: 'a', toEnd: 'b', lengthMm: 250 }]
}

const project: Project = {
  id: 'p1',
  name: 'Test Rig',
  deviceInstances: [
    { id: 'i1', partId: 'dev1', label: 'FC #1', position: { x: 0, y: 0 } },
    { id: 'i2', partId: 'dev1', label: 'FC #2', position: { x: 300, y: 0 } }
  ],
  harnesses: [harness],
  partSnapshots: {},
  templateSnapshots: {}
}

describe('wireLabels', () => {
  it('uses the user label when set and auto-numbers otherwise', () => {
    const labels = wireLabels(harness)
    expect(labels.get('w1')).toBe('W1')
    expect(labels.get('w2')).toBe('GND-LINK')
  })
})

describe('wiringTable', () => {
  it('resolves devices, pins, signals, length and wire part per row', () => {
    const rows = wiringTable(lib, project, harness)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      wire: 'W1',
      fromDevice: 'FC #1',
      fromPort: 'CAN A',
      fromPin: 1,
      fromSignal: '5V',
      toDevice: 'FC #2',
      toSignal: '5V',
      color: 'RD',
      wirePart: 'Hookup 22AWG',
      lengthMm: 250
    })
    expect(rows[0].gauge).toMatch(/^22 AWG/)
  })

  it('serializes to CSV with a header row', () => {
    const csv = wiringCsv(wiringTable(lib, project, harness))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('From Device')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('GND-LINK')
  })
})

describe('cutlist', () => {
  it('groups identical cuts and adds slack', () => {
    const rows = cutlist(lib, project, 50)
    // Two wires, same part/gauge, different colors → two rows of qty 1.
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.cutLengthMm === 300)).toBe(true)
    const again = cutlist(
      lib,
      { ...project, harnesses: [{ ...harness, wires: [...harness.wires, { ...harness.wires[0], id: 'w3' }] }] },
      50
    )
    expect(again.find((r) => r.color === 'RD')?.quantity).toBe(2)
  })

  it('marks unknown lengths instead of guessing', () => {
    const noLen = { ...harness, segments: [] }
    const rows = cutlist(lib, { ...project, harnesses: [noLen] }, 50)
    expect(rows.every((r) => r.cutLengthMm === undefined)).toBe(true)
    expect(cutlistCsv(rows)).toContain('unknown')
  })
})

describe('netlist', () => {
  it('propagates signals across wires into named nets', () => {
    const nets = netlist(lib, project)
    expect(nets).toHaveLength(2)
    const gnd = nets.find((n) => n.name === 'GND')!
    expect(gnd.nodes).toHaveLength(2)
    expect(gnd.nodes.map((n) => n.device).sort()).toEqual(['FC #1', 'FC #2'])
  })

  it('merges nets joined through a shared pin', () => {
    // Third endpoint daisy-chained from FC #2 pin 4 → all three pins one net.
    const chained: Harness = {
      ...harness,
      endpoints: [...harness.endpoints, { deviceInstanceId: 'i3', portId: 'portA' }],
      wires: [
        ...harness.wires,
        { id: 'w3', from: { end: 'b', position: 4 }, to: { end: 'c', position: 4 } }
      ]
    }
    const p3: Project = {
      ...project,
      deviceInstances: [
        ...project.deviceInstances,
        { id: 'i3', partId: 'dev1', label: 'FC #3', position: { x: 600, y: 0 } }
      ],
      harnesses: [chained]
    }
    const gnd = netlist(lib, p3).find((n) => n.name === 'GND')!
    expect(gnd.nodes).toHaveLength(3)
  })
})

describe('runDrc', () => {
  it('is quiet for a healthy fully-wired harness', () => {
    const full: Harness = {
      ...harness,
      wires: [1, 2, 3, 4].map((p) => ({
        id: `w${p}`,
        from: { end: 'a', position: p },
        to: { end: 'b', position: p },
        wirePartId: 'wire1'
      }))
    }
    expect(runDrc(lib, { ...project, harnesses: [full] })).toEqual([])
  })

  it('flags unterminated pins, missing wire parts and missing lengths', () => {
    const partial: Harness = {
      ...harness,
      segments: [],
      wires: [{ id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } }]
    }
    const issues = runDrc(lib, { ...project, harnesses: [partial] })
    const messages = issues.map((i) => i.message).join('\n')
    expect(messages).toContain('no wire part')
    expect(messages).toContain('unterminated')
    expect(messages).toContain('length')
  })

  it('errors when a device references a missing part, with a jump target', () => {
    const broken: Project = {
      ...project,
      deviceInstances: [
        ...project.deviceInstances,
        { id: 'iX', partId: 'nope', label: 'Ghost', position: { x: 0, y: 0 } }
      ]
    }
    const issues = runDrc(lib, broken)
    const missing = issues.find((i) => i.message.includes('Ghost'))!
    expect(missing.severity).toBe('error')
    expect(missing.target).toEqual({ type: 'instance', id: 'iX' })
  })

  it('flags wired endpoint pairs with no segment length (star-wired a–c)', () => {
    const threeEp: Harness = {
      ...harness,
      endpoints: [...harness.endpoints, { deviceInstanceId: 'i3', portId: 'portA' }],
      wires: [
        ...harness.wires,
        { id: 'w5', from: { end: 'a', position: 2 }, to: { end: 'c', position: 2 }, wirePartId: 'wire1' },
        { id: 'w6', from: { end: 'a', position: 3 }, to: { end: 'c', position: 3 }, wirePartId: 'wire1' }
      ]
    }
    const p3: Project = {
      ...project,
      deviceInstances: [
        ...project.deviceInstances,
        { id: 'i3', partId: 'dev1', label: 'FC #3', position: { x: 600, y: 0 } }
      ],
      harnesses: [threeEp]
    }
    const issues = runDrc(lib, p3)
    const lengthWarnings = issues.filter((i) => i.message.includes('segment length'))
    expect(lengthWarnings).toHaveLength(1)
    // a–b has a 250mm segment; only the star pair a–c is uncovered.
    expect(lengthWarnings[0].message).toContain('a–c')
    expect(lengthWarnings[0].message).not.toContain('a–b')
  })

  it('warns on non-mutual twisted-pair references', () => {
    const oneWay: Harness = {
      ...harness,
      wires: harness.wires.map((w, i) => (i === 0 ? { ...w, twistedWith: 'w2' } : w))
    }
    const issues = runDrc(lib, { ...project, harnesses: [oneWay] })
    expect(issues.some((i) => i.message.includes('not mutual'))).toBe(true)
  })
})

describe('wirevizYaml', () => {
  it('emits connectors, one cable per endpoint pair, and aligned connections', () => {
    const yaml = wirevizYaml(lib, project, harness)
    expect(yaml).toContain('connectors:')
    expect(yaml).toContain('  A:')
    expect(yaml).toContain('  B:')
    expect(yaml).toContain('type: "JST GH 4-pos"')
    expect(yaml).toContain('pinlabels: ["5V", "CAN_H", "CAN_L", "GND"]')
    expect(yaml).toContain('CABLE_AB:')
    expect(yaml).toContain('wirecount: 2')
    expect(yaml).toContain('colors: ["RD", "BK"]')
    expect(yaml).toContain('gauge: "22 AWG"')
    expect(yaml).toContain('length: 0.25')
    // Connection block maps A pins 1,4 through the cable to B pins 1,4.
    expect(yaml).toContain('- A: [1, 4]')
    expect(yaml).toContain('- CABLE_AB: [1, 2]')
    expect(yaml).toContain('- B: [1, 4]')
  })
})
