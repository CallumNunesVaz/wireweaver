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

const POSITIONS = [2, 3, 4, 6, 8, 12] as const

function padPos(pos: number): string {
  return String(pos).padStart(2, '0')
}

function makeId(type: 'rec' | 'plug', pos: number): string {
  return `deutsch-dt-${type}-${padPos(pos)}p`
}

const TEMPLATE_PINS: PinoutTemplate[] = [
  {
    id: 'dt-tpl-2pos-power',
    name: 'DT 2-pos Power',
    connectorPartId: makeId('rec', 2),
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 25 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 25 }
    ]
  },
  {
    id: 'dt-tpl-4pos-canpower',
    name: 'DT 4-pos CAN+Power',
    connectorPartId: makeId('rec', 4),
    pins: [
      { position: 1, signal: '+12V', signalClass: 'power', maxCurrentAmps: 13 },
      { position: 2, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 13 },
      { position: 3, signal: 'CAN_H', signalClass: 'data' },
      { position: 4, signal: 'CAN_L', signalClass: 'data' }
    ]
  },
  {
    id: 'dt-tpl-6pos-analog',
    name: 'DT 6-pos Analog',
    connectorPartId: makeId('rec', 6),
    pins: [
      { position: 1, signal: 'AN1', signalClass: 'data' },
      { position: 2, signal: 'AN2', signalClass: 'data' },
      { position: 3, signal: 'AN3', signalClass: 'data' },
      { position: 4, signal: 'AN4', signalClass: 'data' },
      { position: 5, signal: '+5V', signalClass: 'power' },
      { position: 6, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'dt-tpl-6pos-injector',
    name: 'DT 6-pos Injector',
    connectorPartId: makeId('rec', 6),
    pins: [
      { position: 1, signal: 'INJ1', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 2, signal: 'INJ2', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 3, signal: 'INJ3', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 4, signal: 'INJ4', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 5, signal: '+12V', signalClass: 'power', maxCurrentAmps: 25 },
      { position: 6, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 25 }
    ]
  },
  {
    id: 'dt-tpl-8pos-sensor',
    name: 'DT 8-pos Sensor',
    connectorPartId: makeId('rec', 8),
    pins: [
      { position: 1, signal: 'TEMP1', signalClass: 'data' },
      { position: 2, signal: 'TEMP2', signalClass: 'data' },
      { position: 3, signal: 'PRESS1', signalClass: 'data' },
      { position: 4, signal: 'PRESS2', signalClass: 'data' },
      { position: 5, signal: 'TPS', signalClass: 'data' },
      { position: 6, signal: 'MAP', signalClass: 'data' },
      { position: 7, signal: '+5V', signalClass: 'power' },
      { position: 8, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'dt-tpl-12pos-digital',
    name: 'DT 12-pos Digital I/O',
    connectorPartId: makeId('rec', 12),
    pins: [
      { position: 1, signal: 'DIG1', signalClass: 'data' },
      { position: 2, signal: 'DIG2', signalClass: 'data' },
      { position: 3, signal: 'DIG3', signalClass: 'data' },
      { position: 4, signal: 'DIG4', signalClass: 'data' },
      { position: 5, signal: 'DIG5', signalClass: 'data' },
      { position: 6, signal: 'DIG6', signalClass: 'data' },
      { position: 7, signal: 'DIG7', signalClass: 'data' },
      { position: 8, signal: 'DIG8', signalClass: 'data' },
      { position: 9, signal: 'DIG9', signalClass: 'data' },
      { position: 10, signal: 'DIG10', signalClass: 'data' },
      { position: 11, signal: '+12V', signalClass: 'power' },
      { position: 12, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'dt-tpl-3pos-serial',
    name: 'DT 3-pos Serial',
    connectorPartId: makeId('rec', 3),
    pins: [
      { position: 1, signal: 'TX', signalClass: 'data' },
      { position: 2, signal: 'RX', signalClass: 'data' },
      { position: 3, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'dt-tpl-8pos-ignition',
    name: 'DT 8-pos Ignition',
    connectorPartId: makeId('rec', 8),
    pins: [
      { position: 1, signal: 'IGN1', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 2, signal: 'IGN2', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 3, signal: 'IGN3', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 4, signal: 'IGN4', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 5, signal: 'IGN5', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 6, signal: 'IGN6', signalClass: 'power', maxCurrentAmps: 7 },
      { position: 7, signal: '+12V', signalClass: 'power', maxCurrentAmps: 25 },
      { position: 8, signal: 'GND', signalClass: 'ground', maxCurrentAmps: 25 }
    ]
  }
]

function generateAll(): { parts: WireWeaverPart[]; templates: PinoutTemplate[] } {
  const parts: WireWeaverPart[] = []

  for (const pos of POSITIONS) {
    const posStr = padPos(pos)
    const recId = makeId('rec', pos)
    const plugId = makeId('plug', pos)
    const recIpn = `DT04-${posStr}P-E001`
    const plugIpn = `DT06-${posStr}S-E001`

    const rec: WireWeaverPart = {
      id: recId,
      kind: 'connector',
      name: `Deutsch DT04-${pos}P`,
      type: 'COTS',
      internalPartNumber: recIpn,
      manufacturer: 'TE Connectivity (Deutsch)',
      manufacturerPartNumber: `DT04-${posStr}P`,
      manufacturerPartUrl: `https://www.te.com/en/product-DT04-${posStr}P.html`,
      supplier: 'Digi-Key',
      supplierPartNumber: `DT04-${posStr}P`,
      notes: `Deutsch DT series, ${pos}-position receptacle (flange mount). Mates with DT06-${posStr}S.`,
      positions: pos,
      gender: 'female',
      matingConnectorPartId: plugId,
      weightGrams: pos * 1.5 + 5
    }

    const plug: WireWeaverPart = {
      id: plugId,
      kind: 'connector',
      name: `Deutsch DT06-${pos}S`,
      type: 'COTS',
      internalPartNumber: plugIpn,
      manufacturer: 'TE Connectivity (Deutsch)',
      manufacturerPartNumber: `DT06-${posStr}S`,
      manufacturerPartUrl: `https://www.te.com/en/product-DT06-${posStr}S.html`,
      supplier: 'Digi-Key',
      supplierPartNumber: `DT06-${posStr}S`,
      notes: `Deutsch DT series, ${pos}-position plug (inline). Mates with DT04-${posStr}P.`,
      positions: pos,
      gender: 'male',
      matingConnectorPartId: recId,
      weightGrams: pos * 1.5 + 3
    }

    parts.push(rec, plug)
  }

  const templates: PinoutTemplate[] = TEMPLATE_PINS.map((t) => ({
    ...t,
    connectorPartId: t.connectorPartId
  }))

  return { parts, templates }
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/deutsch-dt-connectors.wwlib')
  const { parts, templates } = generateAll()
  const output = { parts, templates }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} connector parts and ${templates.length} templates to ${outPath}\n`)
  const positionsSeen = new Set(parts.map((p) => (p as any).name.match(/DT\d+-(\d+)/)?.[1]).filter(Boolean))
  process.stderr.write(`  Positions: ${[...positionsSeen].join(', ')}\n`)
  process.stderr.write(`  Templates: ${templates.map((t) => t.name).join(', ')}\n`)
}

main()
