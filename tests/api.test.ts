import { describe, it, expect } from 'vitest'
import * as api from '../src/model/api'

function setup() {
  const ws = api.createWorkspace('API Test')
  const conn = api.createConnectorPart(ws, { name: 'JST 4', positions: 4 })
  const tpl = api.createPinoutTemplate(ws, {
    name: 'CAN + Power',
    connectorPartId: conn.id,
    pins: [
      { position: 1, signal: '5V', signalClass: 'power' },
      { position: 2, signal: 'CAN_H', signalClass: 'data' },
      { position: 3, signal: 'CAN_L', signalClass: 'data' },
      { position: 4, signal: 'GND', signalClass: 'ground' }
    ]
  })
  const devA = api.createDevicePart(ws, {
    name: 'Flight Controller',
    ports: [{ name: 'CAN A', pinoutTemplateId: tpl.id, side: 'right' }]
  })
  const devB = api.createDevicePart(ws, {
    name: 'Sensor',
    ports: [{ name: 'CAN', pinoutTemplateId: tpl.id, side: 'left' }]
  })
  const a = api.addDevice(ws, { partId: devA.id, label: 'FC' })
  const b = api.addDevice(ws, { partId: devB.id, label: 'Sensor' })
  return { ws, conn, tpl, devA, devB, a, b }
}

describe('harness creation API', () => {
  it('creates a harness from device/port pairs', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      name: 'CAN Bus',
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    expect(h.name).toBe('CAN Bus')
    expect(h.endpoints).toHaveLength(2)
    expect(ws.project.harnesses).toHaveLength(1)
  })

  it('adds wires addressed by device, port and pin', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 2 },
      to: { device: 'Sensor', port: 'CAN', position: 2 },
      label: 'CAN_H'
    })
    const detail = api.harnessDetail(ws, h.id)
    expect(detail.wires).toHaveLength(1)
    expect(detail.wires[0].fromSignal).toBe('CAN_H')
    expect(detail.wires[0].toSignal).toBe('CAN_H')
  })

  it('auto-wires matching signals across endpoints', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    const added = api.autoWire(ws, h.id)
    expect(added).toHaveLength(4)
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(4)
  })

  it('supports segments, validation and reports', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    api.autoWire(ws, h.id)
    api.addSegment(ws, h.id, { from: 'a', to: 'b', lengthMm: 250 })
    expect(api.wiringTable(ws)).toHaveLength(4)
    expect(api.cutlist(ws, 50).length).toBeGreaterThan(0)
    expect(api.netlist(ws).length).toBeGreaterThan(0)
    expect(api.summarize(ws).harnessCount).toBe(1)
    // No fatal errors: connectors/templates all resolve.
    expect(api.validate(ws).filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('exports BOM and WireViz', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    api.autoWire(ws, h.id)
    const bom = JSON.parse(api.bomText(ws, 'json'))
    expect(Array.isArray(bom)).toBe(true)
    const yaml = api.exportWireViz(ws, h.id)
    expect(yaml).toContain('connectors')
    expect(yaml).toContain('CAN_H')
  })

  it('round-trips through the .wwv snapshot format', () => {
    const { ws } = setup()
    api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    const serialized = api.serializeWorkspace(ws)
    const reloaded = api.loadWorkspace(JSON.parse(JSON.stringify(serialized)))
    expect(reloaded.parts.length).toBe(ws.parts.length)
    expect(reloaded.templates.length).toBe(ws.templates.length)
    expect(reloaded.project.harnesses).toHaveLength(1)
  })

  it('manages revisions and subassemblies', () => {
    const { ws } = setup()
    const h = api.createHarness(ws, {
      ports: [
        { device: 'FC', port: 'CAN A' },
        { device: 'Sensor', port: 'CAN' }
      ]
    })
    const rev = api.createRevision(ws, 'A1')
    api.addWire(ws, h.id, {
      from: { device: 'FC', port: 'CAN A', position: 2 },
      to: { device: 'Sensor', port: 'CAN', position: 2 }
    })
    expect(api.diffRevision(ws, rev.id).length).toBeGreaterThan(0)
    api.restoreRevision(ws, rev.id)
    expect(api.harnessDetail(ws, h.id).wires).toHaveLength(0)

    const sub = api.saveAsSubassembly(ws, h.id, 'CAN sub')
    expect(sub.kind).toBe('subassembly')
    const inserted = api.insertSubassembly(ws, sub.id)
    expect(inserted.harness.endpoints.length).toBeGreaterThanOrEqual(2)
  })
})
