import { describe, it, expect } from 'vitest'
import * as api from '../src/model/api'

function build() {
  const ws = api.createWorkspace('WF')
  const conn = api.createConnectorPart(ws, { name: 'JST 4', positions: 4 })
  const tpl = api.createPinoutTemplate(ws, {
    name: 'CAN',
    connectorPartId: conn.id,
    pins: [
      { position: 1, signal: '5V', signalClass: 'power' },
      { position: 2, signal: 'CAN_H', signalClass: 'data' },
      { position: 3, signal: 'CAN_L', signalClass: 'data' },
      { position: 4, signal: 'GND', signalClass: 'ground' }
    ]
  })
  const wire = api.createWirePart(ws, { name: '22AWG', gauge: '22 AWG', color: '#ff0000' })
  const acc = api.createConnectorPart(ws, { name: 'Backshell', positions: 1 })
  const devA = api.createDevicePart(ws, {
    name: 'FC',
    ports: [{ name: 'CAN A', pinoutTemplateId: tpl.id }]
  })
  const devB = api.createDevicePart(ws, {
    name: 'Sensor',
    ports: [{ name: 'CAN', pinoutTemplateId: tpl.id }]
  })
  const a = api.addDevice(ws, { partId: devA.id, label: 'FC' })
  const b = api.addDevice(ws, { partId: devB.id, label: 'Sensor' })
  const h = api.createHarness(ws, {
    name: 'CAN Bus',
    ports: [
      { device: 'FC', port: 'CAN A' },
      { device: 'Sensor', port: 'CAN' }
    ]
  })
  return { ws, conn, tpl, wire, acc, devA, devB, a, b, h }
}

describe('API part creation', () => {
  it('creates a wire part with sensible defaults', () => {
    const ws = api.createWorkspace()
    const w = api.createWirePart(ws, { name: 'W' })
    expect(w.conductors).toBe(1)
    expect(ws.parts).toContain(w)
  })

  it('defaults connector type to Custom', () => {
    const ws = api.createWorkspace()
    const c = api.createConnectorPart(ws, { name: 'C', positions: 2 })
    expect(c.type).toBe('Custom')
    expect(c.positions).toBe(2)
  })

  it('sizes a template to the connector when pins are omitted', () => {
    const ws = api.createWorkspace()
    const c = api.createConnectorPart(ws, { name: 'C', positions: 3 })
    const t = api.createPinoutTemplate(ws, { name: 'T', connectorPartId: c.id })
    expect(t.pins.map((p) => p.position)).toEqual([1, 2, 3])
  })

  it('upserts a part when the id already exists', () => {
    const ws = api.createWorkspace()
    const c = api.createConnectorPart(ws, { name: 'C', positions: 2 })
    api.addPart(ws, { ...c, name: 'Renamed' })
    expect(ws.parts).toHaveLength(1)
    expect(ws.parts[0].name).toBe('Renamed')
  })

  it('creates a device with ports', () => {
    const { ws, devA, tpl } = build()
    const dev = ws.parts.find((p) => p.id === devA.id)!
    expect(dev.kind).toBe('device')
    if (dev.kind === 'device') {
      expect(dev.ports).toHaveLength(1)
      expect(dev.ports[0].pinoutTemplateId).toBe(tpl.id)
      expect(dev.ports[0].side).toBe('right')
    }
  })
})

describe('API assembly', () => {
  it('places devices by part id or part name with auto labels', () => {
    const ws = api.createWorkspace()
    const dev = api.createDevicePart(ws, { name: 'Radio' })
    const first = api.addDevice(ws, { partId: dev.id })
    const second = api.addDevice(ws, { partName: 'Radio' })
    expect(first.label).toBe('Radio')
    expect(second.label).toBe('Radio 2')
  })

  it('throws for an unknown device part', () => {
    const ws = api.createWorkspace()
    expect(() => api.addDevice(ws, { partName: 'Nope' })).toThrow()
  })

  it('drops a harness when removing a device leaves fewer than two endpoints', () => {
    const { ws, a, h } = build()
    api.removeDevice(ws, a.id)
    expect(ws.project.harnesses.find((x) => x.id === h.id)).toBeUndefined()
  })

  it('lists devices with connection status', () => {
    const { ws, a } = build()
    const list = api.listDevices(ws)
    const fc = list.find((d) => d.id === a.id)!
    expect(fc.partName).toBe('FC')
    expect(fc.ports[0].connected).toBe(true)
  })
})

describe('API harness editing', () => {
  it('renames and deletes harnesses', () => {
    const { ws, h } = build()
    api.renameHarness(ws, h.id, 'Renamed')
    expect(api.harnessDetail(ws, h.id).name).toBe('Renamed')
    api.deleteHarness(ws, h.id)
    expect(ws.project.harnesses).toHaveLength(0)
  })

  it('adds endpoints and returns the existing label for duplicates', () => {
    const { ws, h, a } = build()
    const dev = ws.parts.find((p) => p.id === a.partId)!
    if (dev.kind !== 'device') throw new Error('expected device')
    const first = api.addEndpoint(ws, h.id, { deviceInstanceId: a.id, portId: dev.ports[0].id })
    const again = api.addEndpoint(ws, h.id, { deviceInstanceId: a.id, portId: dev.ports[0].id })
    expect(first).toBe(again)
  })

  it('removes an endpoint and remaps surviving wires', () => {
    const { ws, h, a, b } = build()
    const dev = ws.parts.find((p) => p.id === a.partId)!
    if (dev.kind !== 'device') throw new Error('expected device')
    const c = api.addDevice(ws, { partId: a.partId, label: 'Third' })
    api.addEndpoint(ws, h.id, { deviceInstanceId: c.id, portId: dev.ports[0].id })
    // Wire a–b and b–c, then remove a.
    api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    api.addWire(ws, h.id, {
      from: { device: 'Sensor', port: 'CAN', position: 2 },
      to: { device: 'Third', port: 'CAN A', position: 2 }
    })
    api.removeEndpoint(ws, h.id, 'a')
    const detail = api.harnessDetail(ws, h.id)
    expect(detail.endpoints).toHaveLength(2)
    expect(detail.wires).toHaveLength(1)
    expect(detail.wires[0].from.end).toBe('a')
  })

  it('resolves pin references by device label, port name and instance id', () => {
    const { ws, h, a } = build()
    const byLabel = api.resolvePinRef(ws, h, { device: 'FC', port: 'CAN A', position: 2 })
    const dev = ws.parts.find((p) => p.id === a.partId)!
    if (dev.kind !== 'device') throw new Error('expected device')
    const byId = api.resolvePinRef(ws, h, {
      deviceInstanceId: a.id,
      portId: dev.ports[0].id,
      position: 2
    })
    expect(byLabel).toEqual({ end: 'a', position: 2 })
    expect(byId).toEqual(byLabel)
  })

  it('updates and removes wires', () => {
    const { ws, h } = build()
    const w = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    api.updateWire(ws, h.id, w.id, { color: '#00ff00', label: 'PWR' })
    const updated = api.harnessDetail(ws, h.id).wires[0]
    expect(updated.color).toBe('#00ff00')
    expect(updated.label).toBe('PWR')
    api.removeWire(ws, h.id, w.id)
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(0)
  })

  it('auto-wires, and can overwrite existing wires', () => {
    const { ws, h } = build()
    expect(api.autoWire(ws, h.id)).toHaveLength(4)
    api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(5)
    api.autoWire(ws, h.id, { overwrite: true })
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(4)
  })

  it('auto-wires non-adjacent endpoints when allPairs is set', () => {
    const ws = api.createWorkspace()
    const c = api.createConnectorPart(ws, { name: 'C', positions: 1 })
    const tplX = api.createPinoutTemplate(ws, {
      name: 'X',
      connectorPartId: c.id,
      pins: [{ position: 1, signal: 'X', signalClass: 'data' }]
    })
    const tplN = api.createPinoutTemplate(ws, {
      name: 'N',
      connectorPartId: c.id,
      pins: [{ position: 1, signal: '' }]
    })
    const dX = api.createDevicePart(ws, {
      name: 'DX',
      ports: [{ name: 'P', pinoutTemplateId: tplX.id }]
    })
    const dN = api.createDevicePart(ws, {
      name: 'DN',
      ports: [{ name: 'P', pinoutTemplateId: tplN.id }]
    })
    api.addDevice(ws, { partId: dX.id, label: 'X1' })
    api.addDevice(ws, { partId: dN.id, label: 'N1' })
    api.addDevice(ws, { partId: dX.id, label: 'X2' })
    const h = api.createHarness(ws, {
      ports: [
        { device: 'X1', port: 'P' },
        { device: 'N1', port: 'P' },
        { device: 'X2', port: 'P' }
      ]
    })
    expect(api.autoWire(ws, h.id)).toHaveLength(0)
    expect(api.autoWire(ws, h.id, { allPairs: true })).toHaveLength(1)
  })
})

describe('API segments, accessories and splices', () => {
  it('creates and updates a segment', () => {
    const { ws, h } = build()
    api.addSegment(ws, h.id, { from: 'a', to: 'b', lengthMm: 100 })
    api.addSegment(ws, h.id, { from: 'a', to: 'b', lengthMm: 120, label: 'TRUNK' })
    const segs = api.harnessDetail(ws, h.id).segments
    expect(segs).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 120, label: 'TRUNK' }])
  })

  it('adds and removes accessories', () => {
    const { ws, h, acc } = build()
    const a = api.addAccessory(ws, h.id, {
      category: 'backshell',
      partId: acc.id,
      quantity: 2
    })
    expect(api.harnessDetail(ws, h.id).accessories).toHaveLength(1)
    api.removeAccessory(ws, h.id, a.id)
    expect(api.harnessDetail(ws, h.id).accessories).toHaveLength(0)
  })

  it('adds, assigns and removes splices', () => {
    const { ws, h, wire } = build()
    const w1 = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    const w2 = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 2 },
      to: { device: 'Sensor', port: 'CAN', position: 2 }
    })
    const splice = api.addSplice(ws, h.id, [w1.id, w2.id], 'SP1')
    expect(splice.wireIds).toEqual([w1.id, w2.id])
    api.assignSpliceWire(ws, h.id, splice.id, wire.id)
    expect(api.harnessDetail(ws, h.id).splices[0].wirePartId).toBe(wire.id)
    api.removeSplice(ws, h.id, splice.id)
    expect(api.harnessDetail(ws, h.id).splices).toHaveLength(0)
  })

  it('throws when assigning to an unknown splice', () => {
    const { ws, h, wire } = build()
    expect(() => api.assignSpliceWire(ws, h.id, 'nope', wire.id)).toThrow()
  })
})

describe('API subassemblies', () => {
  it('saves a harness as a subassembly and inserts it back', () => {
    const { ws, h } = build()
    api.autoWire(ws, h.id)
    const sub = api.saveAsSubassembly(ws, h.id, 'CAN sub')
    expect(sub.kind).toBe('subassembly')
    const { harness, matched } = api.insertSubassembly(ws, sub.id)
    expect(matched).toBe(2)
    expect(harness.wires).toHaveLength(4)
  })

  it('throws when inserting an unknown subassembly', () => {
    const { ws } = build()
    expect(() => api.insertSubassembly(ws, 'nope')).toThrow()
  })
})

describe('API WireViz and reports', () => {
  it('imports a WireViz document into the library', () => {
    const ws = api.createWorkspace()
    const res = api.importWireVizDoc(
      ws,
      'connectors:\n  X1:\n    type: Molex\n    pincount: 2\n    pins: [1, 2]\n'
    )
    expect(res.templates).toHaveLength(1)
    expect(ws.parts.some((p) => p.kind === 'connector')).toBe(true)
  })

  it('produces reports and a BOM', () => {
    const { ws, h } = build()
    api.autoWire(ws, h.id)
    api.addSegment(ws, h.id, { from: 'a', to: 'b', lengthMm: 200 })
    expect(api.wiringTable(ws)).toHaveLength(4)
    expect(api.cutlist(ws, 10)[0].cutLengthMm).toBe(210)
    expect(api.netlist(ws).length).toBeGreaterThan(0)
    expect(JSON.parse(api.bomText(ws, 'json')).length).toBeGreaterThan(0)
    expect(api.exportWireViz(ws, h.id)).toContain('connectors:')
    expect(api.summarize(ws)).toMatchObject({ harnessCount: 1, wireCount: 4 })
  })

  it('validates a fully-wired harness as issue-free apart from wire parts', () => {
    const { ws, h } = build()
    api.autoWire(ws, h.id)
    // No wire parts assigned → warnings, but no errors.
    expect(api.validate(ws).filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('reports endpoint signals in harness detail', () => {
    const { ws, h } = build()
    const w = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 2 },
      to: { device: 'Sensor', port: 'CAN', position: 2 }
    })
    const detail = api.harnessDetail(ws, h.id)
    expect(detail.wires.find((x) => x.id === w.id)?.fromSignal).toBe('CAN_H')
    expect(detail.endpoints[0].pins).toHaveLength(4)
  })
})

describe('API revisions and persistence', () => {
  it('creates, lists, diffs and restores revisions', () => {
    const { ws, h } = build()
    const rev = api.createRevision(ws, 'A1', 'first')
    expect(api.listRevisions(ws)).toHaveLength(1)

    api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    expect(api.diffRevision(ws, rev.id).length).toBeGreaterThan(0)
    api.restoreRevision(ws, rev.id)
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(0)
  })

  it('round-trips accessories and splice wire parts through snapshots', () => {
    const { ws, h, acc, wire } = build()
    const w1 = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 1 },
      to: { device: 'Sensor', port: 'CAN', position: 1 }
    })
    const w2 = api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 2 },
      to: { device: 'Sensor', port: 'CAN', position: 2 }
    })
    api.addAccessory(ws, h.id, { category: 'backshell', partId: acc.id, quantity: 1 })
    const splice = api.addSplice(ws, h.id, [w1.id, w2.id])
    api.assignSpliceWire(ws, h.id, splice.id, wire.id)

    const serialized = api.serializeWorkspace(ws)
    expect(serialized.partSnapshots[acc.id]).toBeDefined()
    expect(serialized.partSnapshots[wire.id]).toBeDefined()

    const reloaded = api.loadWorkspace(JSON.parse(JSON.stringify(serialized)))
    const rh = reloaded.project.harnesses[0]
    expect(rh.accessories).toHaveLength(1)
    expect(rh.splices![0].wirePartId).toBe(wire.id)
  })
})
