import type { Part, PinoutTemplate } from './types'

/**
 * Starter library content so a fresh install is immediately explorable:
 * two devices sharing a CAN+power pinout, a connector, a wire, and a template.
 */
export function seedLibrary(): { parts: Part[]; templates: PinoutTemplate[] } {
  const jst: Part = {
    id: 'seed-conn-jstgh4',
    kind: 'connector',
    name: 'JST GH 4-pos',
    type: 'COTS',
    internalPartNumber: 'WW-CONN-0001',
    manufacturer: 'JST',
    manufacturerPartNumber: 'GHR-04V-S',
    supplier: 'Digi-Key',
    supplierPartNumber: '455-1160-ND',
    positions: 4,
    gender: 'female',
    cost: { amount: 0.18, currency: 'USD' },
    weightGrams: 0.4
  }

  const wire: Part = {
    id: 'seed-wire-28awg',
    kind: 'wire',
    name: '28 AWG silicone (red)',
    type: 'COTS',
    internalPartNumber: 'WW-WIRE-0001',
    manufacturer: 'Generic',
    manufacturerPartNumber: 'SIL-28-RED',
    supplier: 'Generic',
    supplierPartNumber: '',
    gauge: '28 AWG',
    color: 'red',
    conductors: 1,
    cost: { amount: 0.05, currency: 'USD' },
    weightGrams: 0.2
  }

  const template: PinoutTemplate = {
    id: 'seed-tpl-canpower',
    name: 'CAN + Power (JST GH 4-pos)',
    connectorPartId: jst.id,
    pins: [
      { position: 1, signal: '5V', signalClass: 'power' },
      { position: 2, signal: 'CAN_H', signalClass: 'data' },
      { position: 3, signal: 'CAN_L', signalClass: 'data' },
      { position: 4, signal: 'GND', signalClass: 'ground' }
    ]
  }

  const flightController: Part = {
    id: 'seed-dev-fc',
    kind: 'device',
    name: 'Flight Controller',
    type: 'COTS',
    internalPartNumber: 'WW-DEV-0001',
    manufacturer: 'Acme Avionics',
    manufacturerPartNumber: 'FC-X1',
    supplier: 'Acme',
    supplierPartNumber: 'FC-X1',
    cost: { amount: 120, currency: 'USD' },
    weightGrams: 32,
    ports: [
      { id: 'p-can-a', name: 'CAN A', pinoutTemplateId: template.id, side: 'right' },
      { id: 'p-can-b', name: 'CAN B', pinoutTemplateId: template.id, side: 'left' }
    ]
  }

  const canSensor: Part = {
    id: 'seed-dev-sensor',
    kind: 'device',
    name: 'CAN Airspeed Sensor',
    type: 'COTS',
    internalPartNumber: 'WW-DEV-0002',
    manufacturer: 'Acme Avionics',
    manufacturerPartNumber: 'AS-100',
    supplier: 'Acme',
    supplierPartNumber: 'AS-100',
    cost: { amount: 45, currency: 'USD' },
    weightGrams: 12,
    ports: [{ id: 'p-can', name: 'CAN', pinoutTemplateId: template.id, side: 'left' }]
  }

  return {
    parts: [jst, wire, flightController, canSensor],
    templates: [template]
  }
}
