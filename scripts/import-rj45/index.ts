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

const PLUG_ID = 'rj45-8p8c-plug'
const JACK_ID = 'rj45-8p8c-jack'

const TEMPLATES: PinoutTemplate[] = [
  {
    id: 'rj45-tpl-t568a',
    name: 'T568A Ethernet',
    connectorPartId: JACK_ID,
    pins: [
      { position: 1, signal: 'TX3+', signalClass: 'data' },
      { position: 2, signal: 'TX3-', signalClass: 'data' },
      { position: 3, signal: 'TX2+', signalClass: 'data' },
      { position: 4, signal: 'RX1+', signalClass: 'data' },
      { position: 5, signal: 'RX1-', signalClass: 'data' },
      { position: 6, signal: 'TX2-', signalClass: 'data' },
      { position: 7, signal: 'TX4+', signalClass: 'data' },
      { position: 8, signal: 'TX4-', signalClass: 'data' }
    ]
  },
  {
    id: 'rj45-tpl-t568b',
    name: 'T568B Ethernet',
    connectorPartId: JACK_ID,
    pins: [
      { position: 1, signal: 'TX2+', signalClass: 'data' },
      { position: 2, signal: 'TX2-', signalClass: 'data' },
      { position: 3, signal: 'TX3+', signalClass: 'data' },
      { position: 4, signal: 'RX1+', signalClass: 'data' },
      { position: 5, signal: 'RX1-', signalClass: 'data' },
      { position: 6, signal: 'TX3-', signalClass: 'data' },
      { position: 7, signal: 'TX4+', signalClass: 'data' },
      { position: 8, signal: 'TX4-', signalClass: 'data' }
    ]
  },
  {
    id: 'rj45-tpl-straight',
    name: '8P8C Straight-through',
    connectorPartId: JACK_ID,
    pins: [
      { position: 1, signal: 'W1', signalClass: 'data' },
      { position: 2, signal: 'W2', signalClass: 'data' },
      { position: 3, signal: 'W3', signalClass: 'data' },
      { position: 4, signal: 'W4', signalClass: 'data' },
      { position: 5, signal: 'W5', signalClass: 'data' },
      { position: 6, signal: 'W6', signalClass: 'data' },
      { position: 7, signal: 'W7', signalClass: 'data' },
      { position: 8, signal: 'W8', signalClass: 'data' }
    ]
  }
]

function generateAll(): { parts: WireWeaverPart[]; templates: PinoutTemplate[] } {
  const plug: WireWeaverPart = {
    id: PLUG_ID,
    kind: 'connector',
    name: '8P8C Modular Plug (RJ45)',
    type: 'COTS',
    internalPartNumber: 'WW-RJ45-8P8C-PLUG',
    manufacturer: 'Stewart Connector',
    manufacturerPartNumber: 'SS-39200-001',
    manufacturerPartUrl: 'https://www.belfuse.com/product-detail/stewart-connector/ss-39200-001',
    supplier: 'Digi-Key',
    supplierPartNumber: 'SS-39200-001',
    notes: '8P8C modular plug for Cat5e/Cat6 termination. Mates with 8P8C modular jack.',
    positions: 8,
    gender: 'male',
    matingConnectorPartId: JACK_ID,
    weightGrams: 2.5
  }

  const jack: WireWeaverPart = {
    id: JACK_ID,
    kind: 'connector',
    name: '8P8C Modular Jack (RJ45)',
    type: 'COTS',
    internalPartNumber: 'WW-RJ45-8P8C-JACK',
    manufacturer: 'Stewart Connector',
    manufacturerPartNumber: 'SS-6488S-A-NF',
    manufacturerPartUrl: 'https://www.belfuse.com/product-detail/stewart-connector/ss-6488s-a-nf',
    supplier: 'Digi-Key',
    supplierPartNumber: 'SS-6488S-A-NF',
    notes: '8P8C modular jack, panel mount. Mates with 8P8C modular plug.',
    positions: 8,
    gender: 'female',
    matingConnectorPartId: PLUG_ID,
    weightGrams: 8.0
  }

  return { parts: [plug, jack], templates: TEMPLATES }
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/rj45-connectors.wwlib')
  const { parts, templates } = generateAll()
  const output = { parts, templates }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} parts and ${templates.length} templates to ${outPath}\n`)
  process.stderr.write(`  Templates: ${templates.map((t) => t.name).join(', ')}\n`)
}

main()
