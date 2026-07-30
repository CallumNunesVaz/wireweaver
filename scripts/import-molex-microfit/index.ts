import * as fs from 'node:fs'
import * as path from 'node:path'

interface WireWeaverPart {
  id: string
  kind: 'connector'
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
  positions: number
  gender?: 'male' | 'female' | 'hermaphroditic'
  matingConnectorPartId?: string
}

interface PinoutTemplate {
  id: string
  name: string
  connectorPartId: string
  pins: { position: number; signal: string; signalClass?: string; maxCurrentAmps?: number }[]
}

const POSITIONS = [2, 3, 4, 6, 8, 10] as const

function padPos(pos: number): string {
  return String(pos).padStart(2, '0')
}

function makeId(type: 'rec' | 'plug', pos: number): string {
  return `molex-microfit-${type}-${padPos(pos)}p`
}

const TEMPLATE_PINS: PinoutTemplate[] = [
  {
    id: 'microfit-tpl-2pos-power',
    name: 'Micro-Fit 2-pos Power',
    connectorPartId: makeId('rec', 2),
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 8 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 8 }
    ]
  },
  {
    id: 'microfit-tpl-4pos-aux',
    name: 'Micro-Fit 4-pos Auxiliary',
    connectorPartId: makeId('rec', 4),
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 5 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 5 },
      { position: 3, signal: 'FAN1', signalClass: 'power', maxCurrentAmps: 3 },
      { position: 4, signal: 'FAN2', signalClass: 'power', maxCurrentAmps: 3 }
    ]
  },
  {
    id: 'microfit-tpl-6pos-data',
    name: 'Micro-Fit 6-pos Data',
    connectorPartId: makeId('rec', 6),
    pins: [
      { position: 1, signal: 'SDA', signalClass: 'data' },
      { position: 2, signal: 'SCL', signalClass: 'data' },
      { position: 3, signal: 'INT', signalClass: 'data' },
      { position: 4, signal: 'EN', signalClass: 'data' },
      { position: 5, signal: '+3.3V', signalClass: 'power' },
      { position: 6, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'microfit-tpl-8pos-led',
    name: 'Micro-Fit 8-pos LED',
    connectorPartId: makeId('rec', 8),
    pins: [
      { position: 1, signal: 'LED_R1', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 2, signal: 'LED_G1', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 3, signal: 'LED_B1', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 4, signal: 'LED_R2', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 5, signal: 'LED_G2', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 6, signal: 'LED_B2', signalClass: 'power', maxCurrentAmps: 1 },
      { position: 7, signal: '+12V', signalClass: 'power', maxCurrentAmps: 5 },
      { position: 8, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 5 }
    ]
  },
  {
    id: 'microfit-tpl-10pos-io',
    name: 'Micro-Fit 10-pos I/O',
    connectorPartId: makeId('rec', 10),
    pins: [
      { position: 1, signal: 'IO1', signalClass: 'data' },
      { position: 2, signal: 'IO2', signalClass: 'data' },
      { position: 3, signal: 'IO3', signalClass: 'data' },
      { position: 4, signal: 'IO4', signalClass: 'data' },
      { position: 5, signal: 'IO5', signalClass: 'data' },
      { position: 6, signal: 'IO6', signalClass: 'data' },
      { position: 7, signal: 'IO7', signalClass: 'data' },
      { position: 8, signal: 'IO8', signalClass: 'data' },
      { position: 9, signal: '+5V', signalClass: 'power' },
      { position: 10, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'microfit-tpl-3pos-motor',
    name: 'Micro-Fit 3-pos Motor',
    connectorPartId: makeId('rec', 3),
    pins: [
      { position: 1, signal: 'PHASE_A', signalClass: 'power', maxCurrentAmps: 5 },
      { position: 2, signal: 'PHASE_B', signalClass: 'power', maxCurrentAmps: 5 },
      { position: 3, signal: 'PHASE_C', signalClass: 'power', maxCurrentAmps: 5 }
    ]
  }
]

function generateAll(): { parts: WireWeaverPart[]; templates: PinoutTemplate[] } {
  const parts: WireWeaverPart[] = []

  for (const pos of POSITIONS) {
    const posStr = padPos(pos)
    const recId = makeId('rec', pos)
    const plugId = makeId('plug', pos)
    const recMpn = `43045-${posStr}00`
    const plugMpn = `43025-${posStr}00`

    const rec: WireWeaverPart = {
      id: recId,
      kind: 'connector',
      name: `Molex Micro-Fit 3.0 ${pos}-pos Receptacle`,
      type: 'COTS',
      internalPartNumber: `WW-MOL-MF-${recId}`,
      manufacturer: 'Molex',
      manufacturerPartNumber: recMpn,
      manufacturerPartUrl: `https://www.molex.com/en-us/part-list/${recMpn}`,
      supplier: 'Digi-Key',
      supplierPartNumber: recMpn,
      notes: `Micro-Fit 3.0 series, 3.0mm pitch, ${pos}-position receptacle. Mates with ${plugMpn}.`,
      positions: pos,
      gender: 'female',
      matingConnectorPartId: plugId,
      weightGrams: pos * 0.8 + 1
    }

    const plug: WireWeaverPart = {
      id: plugId,
      kind: 'connector',
      name: `Molex Micro-Fit 3.0 ${pos}-pos Plug`,
      type: 'COTS',
      internalPartNumber: `WW-MOL-MF-${plugId}`,
      manufacturer: 'Molex',
      manufacturerPartNumber: plugMpn,
      manufacturerPartUrl: `https://www.molex.com/en-us/part-list/${plugMpn}`,
      supplier: 'Digi-Key',
      supplierPartNumber: plugMpn,
      notes: `Micro-Fit 3.0 series, 3.0mm pitch, ${pos}-position plug. Mates with ${recMpn}.`,
      positions: pos,
      gender: 'male',
      matingConnectorPartId: recId,
      weightGrams: pos * 0.8 + 0.5
    }

    parts.push(rec, plug)
  }

  const templates: PinoutTemplate[] = TEMPLATE_PINS.map((t) => ({ ...t }))

  return { parts, templates }
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/molex-microfit-connectors.wwlib')
  const { parts, templates } = generateAll()
  const output = { parts, templates }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} connector parts and ${templates.length} templates to ${outPath}\n`)
  process.stderr.write(`  Templates: ${templates.map((t) => t.name).join(', ')}\n`)
}

main()
