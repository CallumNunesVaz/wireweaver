/**
 * IMPORTANT: Import `data/deutsch-dt-connectors.wwlib` BEFORE importing this file.
 * The pinout templates here reference connector parts from the Deutsch DT library
 * (e.g. `deutsch-dt-rec-02p`, `deutsch-dt-rec-04p`, etc.).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

interface WireWeaverPart {
  id: string
  kind: 'device'
  name: string
  type: 'COTS'
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  manufacturerPartUrl?: string
  supplier: string
  supplierPartNumber: string
  supplierPartUrl?: string
  cost?: { amount: number; currency: string }
  weightGrams?: number
  notes?: string
  ports: {
    id: string
    name: string
    pinoutTemplateId: string
    side: 'left' | 'right' | 'top' | 'bottom'
  }[]
}

interface PinoutTemplate {
  id: string
  name: string
  connectorPartId: string
  pins: { position: number; signal: string; signalClass?: string; maxCurrentAmps?: number }[]
}

// The Deutsch connector IPNs and template IDs from the deutsch .wwlib.
// These are auto-generated — referencing by internalPartNumber is the convention.
const DT_2P_REC_IPN = 'DT04-02P-E001'
const DT_4P_REC_IPN = 'DT04-04P-E001'
const DT_6P_REC_IPN = 'DT04-06P-E001'
const DT_8P_REC_IPN = 'DT04-08P-E001'

// Deutsch template IDs
const DT_TPL_2POS = 'dt-tpl-2pos-power'
const DT_TPL_4POS = 'dt-tpl-4pos-canpower'
const DT_TPL_6POS_INJ = 'dt-tpl-6pos-injector'
const DT_TPL_8POS_SENS = 'dt-tpl-8pos-sensor'
const DT_TPL_6POS_AN = 'dt-tpl-6pos-analog'
const DT_TPL_8POS_IGN = 'dt-tpl-8pos-ignition'

// Since we're generating templates locally, we embed them.
const LOCAL_TEMPLATES: PinoutTemplate[] = [
  {
    id: 'ecu-tpl-injector-4p',
    name: 'Injector Outputs 4-pos',
    connectorPartId: 'deutsch-dt-rec-04p',
    pins: [
      { position: 1, signal: 'INJ1', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 2, signal: 'INJ2', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 3, signal: 'INJ3', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 4, signal: 'INJ4', signalClass: 'power', maxCurrentAmps: 7 }
    ]
  },
  {
    id: 'ecu-tpl-ignition-6p',
    name: 'Ignition Outputs 6-pos',
    connectorPartId: 'deutsch-dt-rec-06p',
    pins: [
      { position: 1, signal: 'IGN1', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 2, signal: 'IGN2', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 3, signal: 'IGN3', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 4, signal: 'IGN4', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 5, signal: 'IGN5', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 6, signal: 'IGN6', signalClass: 'power', maxCurrentAmps: 7 }
    ]
  },
  {
    id: 'ecu-tpl-sensor-8p',
    name: 'Sensor Inputs 8-pos',
    connectorPartId: 'deutsch-dt-rec-08p',
    pins: [
      { position: 1, signal: 'AN1', signalClass: 'data' },
      { position: 2, signal: 'AN2', signalClass: 'data' },
      { position: 3, signal: 'TEMP1', signalClass: 'data' },
      { position: 4, signal: 'TEMP2', signalClass: 'data' },
      { position: 5, signal: 'KNOCK1', signalClass: 'data' },
      { position: 6, signal: 'KNOCK2', signalClass: 'data' },
      { position: 7, signal: '+5V', signalClass: 'power' },
      { position: 8, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'ecu-tpl-can-4p',
    name: 'CAN Bus 4-pos',
    connectorPartId: 'deutsch-dt-rec-04p',
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 5 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 5 },
      { position: 3, signal: 'CAN_H', signalClass: 'data' },
      { position: 4, signal: 'CAN_L', signalClass: 'data' }
    ]
  },
  {
    id: 'ecu-tpl-power-2p',
    name: 'ECU Power 2-pos',
    connectorPartId: 'deutsch-dt-rec-02p',
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 25 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 25 }
    ]
  }
]

function makeDevice(id: string, name: string, manufacturer: string, mpn: string, ports: { id: string; name: string; pinoutTemplateId: string; side: 'left' | 'right' | 'top' | 'bottom' }[]): WireWeaverPart {
  return {
    id,
    kind: 'device',
    name,
    type: 'COTS',
    internalPartNumber: `WW-ECU-${id}`,
    manufacturer,
    manufacturerPartNumber: mpn,
    supplier: manufacturer,
    supplierPartNumber: mpn,
    cost: { amount: 1200, currency: 'USD' },
    weightGrams: 350,
    notes: `${name} racing ECU/PDM. Deutsch DT connector ecosystem.`,
    ports
  }
}

function generateAll(): { parts: WireWeaverPart[]; templates: PinoutTemplate[] } {
  const haltech = makeDevice(
    'ecu-haltech-elite2500',
    'Haltech Elite 2500',
    'Haltech',
    'HT-151201',
    [
      { id: 'ht-inj', name: 'Injector Outputs', pinoutTemplateId: 'ecu-tpl-injector-4p', side: 'right' },
      { id: 'ht-ign', name: 'Ignition Outputs', pinoutTemplateId: 'ecu-tpl-ignition-6p', side: 'right' },
      { id: 'ht-sens', name: 'Sensor Inputs', pinoutTemplateId: 'ecu-tpl-sensor-8p', side: 'left' },
      { id: 'ht-can', name: 'CAN Bus', pinoutTemplateId: 'ecu-tpl-can-4p', side: 'left' },
      { id: 'ht-pwr', name: 'Power', pinoutTemplateId: 'ecu-tpl-power-2p', side: 'bottom' }
    ]
  )

  const motec = makeDevice(
    'ecu-motec-m150',
    'Motec M150',
    'Motec',
    'M150',
    [
      { id: 'mt-inj', name: 'Injector Outputs', pinoutTemplateId: 'ecu-tpl-injector-4p', side: 'right' },
      { id: 'mt-ign', name: 'Ignition Outputs', pinoutTemplateId: 'ecu-tpl-ignition-6p', side: 'right' },
      { id: 'mt-sens', name: 'Sensor Inputs', pinoutTemplateId: 'ecu-tpl-sensor-8p', side: 'left' },
      { id: 'mt-can', name: 'CAN Bus', pinoutTemplateId: 'ecu-tpl-can-4p', side: 'left' },
      { id: 'mt-pwr', name: 'Power', pinoutTemplateId: 'ecu-tpl-power-2p', side: 'bottom' }
    ]
  )

  const link = makeDevice(
    'ecu-link-g4x-xtremex',
    'Link G4X XtremeX',
    'Link ECU',
    'G4X-XTREMEX',
    [
      { id: 'lk-inj', name: 'Injector Outputs', pinoutTemplateId: 'ecu-tpl-injector-4p', side: 'right' },
      { id: 'lk-ign', name: 'Ignition Outputs', pinoutTemplateId: 'ecu-tpl-ignition-6p', side: 'right' },
      { id: 'lk-sens', name: 'Sensor Inputs', pinoutTemplateId: 'ecu-tpl-sensor-8p', side: 'left' },
      { id: 'lk-can', name: 'CAN Bus', pinoutTemplateId: 'ecu-tpl-can-4p', side: 'left' },
      { id: 'lk-pwr', name: 'Power', pinoutTemplateId: 'ecu-tpl-power-2p', side: 'bottom' }
    ]
  )

  const ecumaster = makeDevice(
    'ecu-ecumaster-emu-black',
    'ECUMaster EMU Black',
    'ECUMaster',
    'EMU-BLACK',
    [
      { id: 'em-inj', name: 'Injector Outputs', pinoutTemplateId: 'ecu-tpl-injector-4p', side: 'right' },
      { id: 'em-ign', name: 'Ignition Outputs', pinoutTemplateId: 'ecu-tpl-ignition-6p', side: 'right' },
      { id: 'em-sens', name: 'Sensor Inputs', pinoutTemplateId: 'ecu-tpl-sensor-8p', side: 'left' },
      { id: 'em-can', name: 'CAN Bus', pinoutTemplateId: 'ecu-tpl-can-4p', side: 'left' },
      { id: 'em-pwr', name: 'Power', pinoutTemplateId: 'ecu-tpl-power-2p', side: 'bottom' }
    ]
  )

  const parts: WireWeaverPart[] = [haltech, motec, link, ecumaster]

  return { parts, templates: LOCAL_TEMPLATES }
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/ecu-pdm-templates.wwlib')
  const { parts, templates } = generateAll()
  const output = { parts, templates }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} devices and ${templates.length} templates to ${outPath}\n`)
  process.stderr.write(`  Devices: ${parts.map((p) => p.name).join(', ')}\n`)
}

main()
