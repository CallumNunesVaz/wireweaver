import { describe, it, expect } from 'vitest'
import { findPartReferences, findTemplateReferences } from '../src/model/references'
import { withSnapshots, missingFromLibrary } from '../src/model/snapshot'
import { bomTotals, type BomRow } from '../src/model/bom'
import type {
  ConnectorPart,
  DevicePart,
  PinoutTemplate,
  Project,
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
      a: { deviceInstanceId: 'i1', portId: 'portA' },
      b: { deviceInstanceId: 'i2', portId: 'portA' },
      wires: [
        {
          id: 'w1',
          from: { end: 'a', position: 1 },
          to: { end: 'b', position: 1 },
          wirePartId: 'wire1'
        }
      ]
    }
  ],
  partSnapshots: {},
  templateSnapshots: {}
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
