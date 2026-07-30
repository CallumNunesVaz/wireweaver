import { describe, it, expect } from 'vitest'
import { findPartReferences, findTemplateReferences } from '../src/model/references'
import { withSnapshots, missingFromLibrary } from '../src/model/snapshot'
import { bomTotals, type BomRow } from '../src/model/bom'
import { runDrc } from '../src/model/drc'
import { validateSplices } from '../src/model/derivation'
import { voltageDrop, ampacityAwg, powerLost } from '../src/model/calculators'
import type {
  ConnectorPart,
  DevicePart,
  Harness,
  PinoutTemplate,
  Project,
  ProjectRevision,
  WirePart
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

const wire: WirePart = {
  id: 'wire1',
  kind: 'wire',
  name: '28 AWG',
  type: 'COTS',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: ''
}

const template: PinoutTemplate = {
  id: 'tpl1',
  name: 'CAN + Power',
  connectorPartId: 'conn1',
  pins: [{ position: 1, signal: '5V', signalClass: 'power' }]
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

const parts = [connector, wire, device]
const templates = [template]

const project: Project = {
  id: 'p1',
  name: 'Test',
  deviceInstances: [
    { id: 'i1', partId: 'dev1', label: 'FC #1', position: { x: 0, y: 0 } },
    { id: 'i2', partId: 'dev1', label: 'FC #2', position: { x: 300, y: 0 } }
  ],
  harnesses: [
    {
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
          wirePartId: 'wire1'
        }
      ],
      segments: []
    }
  ],
  partSnapshots: {},
  templateSnapshots: {},
  revisions: []
}

describe('findPartReferences', () => {
  it('reports placed instances for a device', () => {
    const refs = findPartReferences('dev1', parts, templates, project)
    expect(refs).toEqual(['2 placed instances'])
  })

  it('reports templates using a connector', () => {
    const refs = findPartReferences('conn1', parts, templates, project)
    expect(refs.some((r) => r.includes('CAN + Power'))).toBe(true)
  })

  it('reports harness wires using a wire part', () => {
    const refs = findPartReferences('wire1', parts, templates, project)
    expect(refs).toEqual(['1 harness wire'])
  })

  it('is empty for an unreferenced part', () => {
    const lonely: WirePart = { ...wire, id: 'wire2' }
    expect(findPartReferences('wire2', [...parts, lonely], templates, project)).toEqual([])
  })
})

describe('findTemplateReferences', () => {
  it('reports device ports using a template', () => {
    expect(findTemplateReferences('tpl1', parts)).toEqual(['Flight Controller · CAN A'])
  })
})

describe('withSnapshots', () => {
  it('snapshots devices, their port templates, template connectors, and wire parts', () => {
    const snap = withSnapshots(project, parts, templates)
    expect(Object.keys(snap.partSnapshots).sort()).toEqual(['conn1', 'dev1', 'wire1'])
    expect(Object.keys(snap.templateSnapshots)).toEqual(['tpl1'])
  })

  it('missingFromLibrary returns only entries the library lacks', () => {
    const snap = withSnapshots(project, parts, templates)
    // Library missing the wire part and the template.
    const missing = missingFromLibrary(snap, [connector, device], [])
    expect(missing.parts.map((p) => p.id)).toEqual(['wire1'])
    expect(missing.templates.map((t) => t.id)).toEqual(['tpl1'])
  })
})

describe('bomTotals', () => {
  it('sums weight by quantity and cost per currency', () => {
    const rows: BomRow[] = [
      {
        category: 'device',
        name: 'A',
        ipn: '',
        manufacturer: '',
        mpn: '',
        quantity: 2,
        cost: { amount: 10, currency: 'USD' },
        weightGrams: 30
      },
      {
        category: 'connector',
        name: 'B',
        ipn: '',
        manufacturer: '',
        mpn: '',
        quantity: 4,
        cost: { amount: 0.5, currency: 'AUD' },
        weightGrams: 0.5
      },
      {
        category: 'wire',
        name: 'C',
        ipn: '',
        manufacturer: '',
        mpn: '',
        quantity: 3
      }
    ]
    const t = bomTotals(rows)
    expect(t.weightGrams).toBe(62)
    expect(t.costByCurrency.get('USD')).toBe(20)
    expect(t.costByCurrency.get('AUD')).toBe(2)
    expect(t.costByCurrency.has('EUR')).toBe(false)
  })
})

describe('drc - placeholder parts', () => {
  it('warns when a device is a placeholder', () => {
    const placeholderDevice: DevicePart = {
      id: 'ph-dev',
      kind: 'device',
      name: 'Generic Device',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      ports: [],
      isPlaceholder: true
    }
    const proj: Project = {
      ...project,
      deviceInstances: [
        { id: 'i-place', partId: 'ph-dev', label: 'Ghost', position: { x: 0, y: 0 } }
      ],
      harnesses: []
    }
    const lib = { parts: { 'ph-dev': placeholderDevice, conn1: connector, dev1: device, wire1: wire }, templates: { tpl1: template } }
    const issues = runDrc(lib, proj)
    expect(issues.some((i) => i.message.includes('placeholder'))).toBe(true)
  })

  it('warns when a connector is a placeholder', () => {
    const placeholderConn: ConnectorPart = {
      id: 'ph-conn',
      kind: 'connector',
      name: 'Unspecified Connector',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      positions: 4,
      isPlaceholder: true
    }
    const tplPlaceholder: PinoutTemplate = {
      id: 'tpl-ph',
      name: 'Placeholder Template',
      connectorPartId: 'ph-conn',
      pins: [{ position: 1, signal: 'A', signalClass: 'data' }]
    }
    const devWithPh: DevicePart = {
      id: 'dev-ph-conn',
      kind: 'device',
      name: 'Device with placeholder conn',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      ports: [{ id: 'portA', name: 'A', pinoutTemplateId: 'tpl-ph', side: 'right' }]
    }
    const proj: Project = {
      id: 'p2',
      name: 'PH',
      deviceInstances: [
        { id: 'i1', partId: 'dev-ph-conn', label: 'D1', position: { x: 0, y: 0 } },
        { id: 'i2', partId: 'dev-ph-conn', label: 'D2', position: { x: 300, y: 0 } }
      ],
      harnesses: [
        {
          id: 'h1',
          name: 'H1',
          endpoints: [
            { deviceInstanceId: 'i1', portId: 'portA' },
            { deviceInstanceId: 'i2', portId: 'portA' }
          ],
          wires: [
            {
              id: 'w1',
              from: { end: 'a', position: 1 },
              to: { end: 'b', position: 1 }
            }
          ],
          segments: [],
          accessories: [],
          splices: []
        }
      ],
      partSnapshots: {},
      templateSnapshots: {}
    }
    const issues = runDrc(
      {
        parts: { 'ph-conn': placeholderConn, 'dev-ph-conn': devWithPh },
        templates: { 'tpl-ph': tplPlaceholder }
      },
      proj
    )
    expect(issues.some((i) => i.message.includes('placeholder'))).toBe(true)
  })

  it('warns when a wire part is a placeholder', () => {
    const placeholderWire: WirePart = {
      id: 'ph-wire',
      kind: 'wire',
      name: 'Unspecified Wire',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      isPlaceholder: true
    }
    const proj: Project = {
      id: 'p3',
      name: 'PH',
      deviceInstances: [
        { id: 'i1', partId: 'dev1', label: 'D1', position: { x: 0, y: 0 } },
        { id: 'i2', partId: 'dev1', label: 'D2', position: { x: 300, y: 0 } }
      ],
      harnesses: [
        {
          id: 'h1',
          name: 'H1',
          endpoints: [
            { deviceInstanceId: 'i1', portId: 'portA' },
            { deviceInstanceId: 'i2', portId: 'portA' }
          ],
          wires: [
            {
              id: 'w1',
              from: { end: 'a', position: 1 },
              to: { end: 'b', position: 1 },
              wirePartId: 'ph-wire'
            }
          ],
          segments: [],
          accessories: [],
          splices: []
        }
      ],
      partSnapshots: {},
      templateSnapshots: {}
    }
    const issues = runDrc(
      {
        parts: { conn1: connector, dev1: device, 'ph-wire': placeholderWire, wire1: wire },
        templates: { tpl1: template }
      },
      proj
    )
    expect(issues.some((i) => i.message.includes('placeholder'))).toBe(true)
  })
})

describe('drc - current rating', () => {
  it('errors when pin max current exceeds connector rating', () => {
    const ratedConn: ConnectorPart = {
      id: 'conn-rated',
      kind: 'connector',
      name: 'Low-Amp Conn',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      positions: 4,
      currentRatingAmps: 5
    }
    const hiTpl: PinoutTemplate = {
      id: 'tpl-hi',
      name: 'High Current',
      connectorPartId: 'conn-rated',
      pins: [
        { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 25 }
      ]
    }
    const hiDev: DevicePart = {
      id: 'dev-hi',
      kind: 'device',
      name: 'High Current Device',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      ports: [{ id: 'pwr', name: 'Power', pinoutTemplateId: 'tpl-hi', side: 'right' }]
    }
    const proj: Project = {
      id: 'p4',
      name: 'Current',
      deviceInstances: [
        { id: 'i1', partId: 'dev-hi', label: 'D1', position: { x: 0, y: 0 } },
        { id: 'i2', partId: 'dev-hi', label: 'D2', position: { x: 300, y: 0 } }
      ],
      harnesses: [
        {
          id: 'h1',
          name: 'H1',
          endpoints: [
            { deviceInstanceId: 'i1', portId: 'pwr' },
            { deviceInstanceId: 'i2', portId: 'pwr' }
          ],
          wires: [
            {
              id: 'w1',
              from: { end: 'a', position: 1 },
              to: { end: 'b', position: 1 }
            }
          ],
          segments: [],
          accessories: [],
          splices: []
        }
      ],
      partSnapshots: {},
      templateSnapshots: {}
    }
    const issues = runDrc(
      {
        parts: { 'conn-rated': ratedConn, 'dev-hi': hiDev },
        templates: { 'tpl-hi': hiTpl }
      },
      proj
    )
    const currentIssue = issues.find((i) => i.message.includes('current'))
    expect(currentIssue).toBeDefined()
    expect(currentIssue!.severity).toBe('error')
    expect(currentIssue!.message).toContain('5A')
  })
})

describe('drc - shield continuity', () => {
  it('warns when shielded wire is not connected to ground', () => {
    const shieldedWire: WirePart = {
      id: 'w-shield',
      kind: 'wire',
      name: 'Shielded Cable',
      type: 'COTS',
      internalPartNumber: '',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplier: '',
      supplierPartNumber: '',
      shield: true
    }
    const proj: Project = {
      id: 'p5',
      name: 'Shield',
      deviceInstances: [
        { id: 'i1', partId: 'dev1', label: 'D1', position: { x: 0, y: 0 } },
        { id: 'i2', partId: 'dev1', label: 'D2', position: { x: 300, y: 0 } }
      ],
      harnesses: [
        {
          id: 'h1',
          name: 'H1',
          endpoints: [
            { deviceInstanceId: 'i1', portId: 'portA' },
            { deviceInstanceId: 'i2', portId: 'portA' }
          ],
          wires: [
            {
              id: 'w1',
              from: { end: 'a', position: 1 },
              to: { end: 'b', position: 1 },
              wirePartId: 'w-shield'
            }
          ],
          segments: [],
          accessories: [],
          splices: []
        }
      ],
      partSnapshots: {},
      templateSnapshots: {}
    }
    const issues = runDrc(
      {
        parts: { conn1: connector, dev1: device, 'w-shield': shieldedWire, wire1: wire },
        templates: { tpl1: template }
      },
      proj
    )
    expect(issues.some((i) => i.message.includes('Shield'))).toBe(true)
  })
})

describe('validateSplices', () => {
  const base: Harness = {
    id: 'h1',
    name: 'Splices',
    endpoints: [
      { deviceInstanceId: 'i1', portId: 'portA' },
      { deviceInstanceId: 'i2', portId: 'portA' }
    ],
    wires: [
      { id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
      { id: 'w2', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
      { id: 'w3', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } }
    ],
    segments: [],
    accessories: [],
    splices: []
  }

  it('is clean for valid splices', () => {
    const h: Harness = {
      ...base,
      splices: [{ id: 's1', name: 'S1', wireIds: ['w1', 'w2'] }]
    }
    expect(validateSplices(h)).toEqual([])
  })

  it('warns when a splice has fewer than 2 wires', () => {
    const h: Harness = {
      ...base,
      splices: [{ id: 's1', name: 'S1', wireIds: ['w1'] }]
    }
    const warnings = validateSplices(h)
    expect(warnings.some((w) => w.includes('fewer than 2'))).toBe(true)
  })

  it('warns when a splice references a missing wire', () => {
    const h: Harness = {
      ...base,
      splices: [{ id: 's1', name: 'S1', wireIds: ['w1', 'ghost'] }]
    }
    const warnings = validateSplices(h)
    expect(warnings.some((w) => w.includes('does not exist'))).toBe(true)
  })

  it('warns when a wire is in multiple splices', () => {
    const h: Harness = {
      ...base,
      splices: [
        { id: 's1', name: 'S1', wireIds: ['w1', 'w2'] },
        { id: 's2', name: 'S2', wireIds: ['w1', 'w3'] }
      ]
    }
    const warnings = validateSplices(h)
    expect(warnings.some((w) => w.includes('both splice'))).toBe(true)
  })
})

describe('electrical calculators', () => {
  it('voltageDrop computes correctly for 22 AWG wire', () => {
    const vd = voltageDrop(5, 10, 22)
    expect(vd).toBeGreaterThan(0)
    expect(vd).toBeCloseTo(5.296, 2)
  })

  it('ampacityAwg returns reasonable values', () => {
    expect(ampacityAwg(22)).toBe(7)
    expect(ampacityAwg(10)).toBe(55)
    expect(ampacityAwg(99)).toBe(0)
  })

  it('powerLost is voltageDrop × current', () => {
    expect(powerLost(0.5, 2)).toBe(1)
    expect(powerLost(0, 10)).toBe(0)
  })
})

describe('subassembly and revisions', () => {
  it('creates a subassembly from a harness', () => {
    const subHarness: Harness = {
      id: 'h-sub',
      name: 'Sub Harness',
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'i2', portId: 'portA' }
      ],
      wires: [],
      segments: []
    }
    const sub = {
      id: 'sub1',
      kind: 'subassembly' as const,
      name: 'SubAssembly',
      type: 'COTS' as const,
      internalPartNumber: 'IPN-SUB-1',
      manufacturer: 'TestCo',
      manufacturerPartNumber: 'MPN-SUB-1',
      supplier: 'TestCo',
      supplierPartNumber: '',
      harness: subHarness,
      exposedPorts: [
        { id: 'ep1', name: 'External CAN', pinoutTemplateId: 'tpl1', side: 'right' as const }
      ]
    }
    expect(sub.kind).toBe('subassembly')
    expect(sub.harness.id).toBe('h-sub')
    expect(sub.exposedPorts).toHaveLength(1)
  })

  it('creates and restores project revisions', () => {
    const rev: ProjectRevision = {
      id: 'rev1',
      timestamp: Date.now(),
      label: 'v1.0',
      description: 'Initial release',
      project: {
        id: project.id,
        name: project.name,
        deviceInstances: [...project.deviceInstances],
        harnesses: [...project.harnesses],
        partSnapshots: { ...project.partSnapshots },
        templateSnapshots: { ...project.templateSnapshots },
        revision: 'A',
        author: 'Tester',
        description: 'Test project'
      }
    }
    expect(rev.label).toBe('v1.0')
    expect(rev.project.deviceInstances).toHaveLength(2)
    expect(rev.project.harnesses).toHaveLength(1)
    expect(rev.project.author).toBe('Tester')

    const restored = rev.project
    const updated = {
      ...restored,
      deviceInstances: [...restored.deviceInstances, { id: 'i3', partId: 'dev1', label: 'D3', position: { x: 600, y: 0 } }]
    }
    expect(updated.deviceInstances).toHaveLength(3)
    expect(restored.deviceInstances).toHaveLength(2)
  })
})
