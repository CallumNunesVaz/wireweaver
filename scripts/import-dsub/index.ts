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

interface Variant {
  shell: string
  positions: number
  name: string
  desc: string
}

const VARIANTS: Variant[] = [
  { shell: 'DE-9', positions: 9, name: 'DE-9', desc: 'D-Sub DE-9' },
  { shell: 'DA-15', positions: 15, name: 'DA-15', desc: 'D-Sub DA-15' },
  { shell: 'DB-25', positions: 25, name: 'DB-25', desc: 'D-Sub DB-25' }
]

function makeId(variant: string, gender: 'm' | 'f'): string {
  return `dsub-${variant.toLowerCase()}-${gender}`
}

const TEMPLATES: PinoutTemplate[] = [
  {
    id: 'dsub-tpl-de9-rs232',
    name: 'DE-9 RS-232',
    connectorPartId: makeId('DE-9', 'm'),
    pins: [
      { position: 1, signal: 'DCD', signalClass: 'data' },
      { position: 2, signal: 'RXD', signalClass: 'data' },
      { position: 3, signal: 'TXD', signalClass: 'data' },
      { position: 4, signal: 'DTR', signalClass: 'data' },
      { position: 5, signal: 'GND', signalClass: 'ground' },
      { position: 6, signal: 'DSR', signalClass: 'data' },
      { position: 7, signal: 'RTS', signalClass: 'data' },
      { position: 8, signal: 'CTS', signalClass: 'data' },
      { position: 9, signal: 'RI', signalClass: 'data' }
    ]
  },
  {
    id: 'dsub-tpl-db25-parallel',
    name: 'DB-25 Parallel',
    connectorPartId: makeId('DB-25', 'f'),
    pins: [
      { position: 1, signal: 'STROBE', signalClass: 'data' },
      { position: 2, signal: 'D0', signalClass: 'data' },
      { position: 3, signal: 'D1', signalClass: 'data' },
      { position: 4, signal: 'D2', signalClass: 'data' },
      { position: 5, signal: 'D3', signalClass: 'data' },
      { position: 6, signal: 'D4', signalClass: 'data' },
      { position: 7, signal: 'D5', signalClass: 'data' },
      { position: 8, signal: 'D6', signalClass: 'data' },
      { position: 9, signal: 'D7', signalClass: 'data' },
      { position: 10, signal: 'ACK', signalClass: 'data' },
      { position: 11, signal: 'BUSY', signalClass: 'data' },
      { position: 12, signal: 'PE', signalClass: 'data' },
      { position: 13, signal: 'SLCT', signalClass: 'data' },
      { position: 14, signal: 'AFD', signalClass: 'data' },
      { position: 15, signal: 'ERR', signalClass: 'data' },
      { position: 16, signal: 'INIT', signalClass: 'data' },
      { position: 17, signal: 'SLIN', signalClass: 'data' },
      { position: 18, signal: 'GND', signalClass: 'ground' },
      { position: 19, signal: 'GND', signalClass: 'ground' },
      { position: 20, signal: 'GND', signalClass: 'ground' },
      { position: 21, signal: 'GND', signalClass: 'ground' },
      { position: 22, signal: 'GND', signalClass: 'ground' },
      { position: 23, signal: 'GND', signalClass: 'ground' },
      { position: 24, signal: 'GND', signalClass: 'ground' },
      { position: 25, signal: 'GND', signalClass: 'ground' }
    ]
  },
  {
    id: 'dsub-tpl-da15-vga',
    name: 'DA-15 VGA',
    connectorPartId: makeId('DA-15', 'm'),
    pins: [
      { position: 1, signal: 'RED', signalClass: 'data' },
      { position: 2, signal: 'GREEN', signalClass: 'data' },
      { position: 3, signal: 'BLUE', signalClass: 'data' },
      { position: 4, signal: 'MONID2', signalClass: 'data' },
      { position: 5, signal: 'GND', signalClass: 'ground' },
      { position: 6, signal: 'RED_RTN', signalClass: 'ground' },
      { position: 7, signal: 'GREEN_RTN', signalClass: 'ground' },
      { position: 8, signal: 'BLUE_RTN', signalClass: 'ground' },
      { position: 9, signal: '+5V', signalClass: 'power' },
      { position: 10, signal: 'GND', signalClass: 'ground' },
      { position: 11, signal: 'MONID0', signalClass: 'data' },
      { position: 12, signal: 'DDC_SDA', signalClass: 'data' },
      { position: 13, signal: 'HSYNC', signalClass: 'data' },
      { position: 14, signal: 'VSYNC', signalClass: 'data' },
      { position: 15, signal: 'DDC_SCL', signalClass: 'data' }
    ]
  }
]

function generateAll(): { parts: WireWeaverPart[]; templates: PinoutTemplate[] } {
  const parts: WireWeaverPart[] = []

  for (const v of VARIANTS) {
    const maleId = makeId(v.name, 'm')
    const femaleId = makeId(v.name, 'f')
    const maleMpn = `${v.shell}-M`
    const femaleMpn = `${v.shell}-F`

    const male: WireWeaverPart = {
      id: maleId,
      kind: 'connector',
      name: `${v.desc} Male`,
      type: 'COTS',
      internalPartNumber: `WW-DSUB-${maleId}`,
      manufacturer: 'Amphenol',
      manufacturerPartNumber: `${v.shell}M`,
      manufacturerPartUrl: `https://www.amphenol-cs.com/product/${v.shell.toLowerCase()}m.html`,
      supplier: 'Digi-Key',
      supplierPartNumber: maleMpn,
      notes: `${v.desc} male connector. Mates with ${v.desc} female.`,
      positions: v.positions,
      gender: 'male',
      matingConnectorPartId: femaleId,
      weightGrams: v.positions * 0.8 + 5
    }

    const female: WireWeaverPart = {
      id: femaleId,
      kind: 'connector',
      name: `${v.desc} Female`,
      type: 'COTS',
      internalPartNumber: `WW-DSUB-${femaleId}`,
      manufacturer: 'Amphenol',
      manufacturerPartNumber: `${v.shell}F`,
      manufacturerPartUrl: `https://www.amphenol-cs.com/product/${v.shell.toLowerCase()}f.html`,
      supplier: 'Digi-Key',
      supplierPartNumber: femaleMpn,
      notes: `${v.desc} female connector. Mates with ${v.desc} male.`,
      positions: v.positions,
      gender: 'female',
      matingConnectorPartId: maleId,
      weightGrams: v.positions * 0.8 + 5
    }

    parts.push(male, female)
  }

  const templates: PinoutTemplate[] = TEMPLATES.map((t) => ({ ...t }))

  return { parts, templates }
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/dsub-connectors.wwlib')
  const { parts, templates } = generateAll()
  const output = { parts, templates }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} connector parts and ${templates.length} templates to ${outPath}\n`)
  process.stderr.write(`  Variants: ${VARIANTS.map((v) => v.name).join(', ')}\n`)
  process.stderr.write(`  Templates: ${templates.map((t) => t.name).join(', ')}\n`)
}

main()
