import * as fs from 'node:fs'
import * as path from 'node:path'

interface JstSeries {
  name: string
  pitch: string
  mountType: string
  boardMpn: string       // {pos} -> position
  wireMpn: string        // {pos} -> position
  crimpContact: string
  positions: number[]
  wireBaseName: (pos: string) => string
  boardBaseName: (pos: string) => string
}

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

const SERIES: JstSeries[] = [
  {
    name: 'GH',
    pitch: '1.25 mm',
    mountType: 'SMD',
    boardMpn: 'BM{pos}B-GHS-TBT',
    wireMpn: 'GHR-{pos}V-S',
    crimpContact: 'SSHL-002T-P0.2',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST GH ${pos}-pos SMD header`,
    wireBaseName: (pos) => `JST GH ${pos}-pos housing`
  },
  {
    name: 'PH',
    pitch: '2.0 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-PH-K-S',
    wireMpn: 'PHR-{pos}',
    crimpContact: 'SPH-002T-P0.5S',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST PH ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST PH ${pos}-pos housing`
  },
  {
    name: 'SH',
    pitch: '1.0 mm',
    mountType: 'SMD',
    boardMpn: 'BM{pos}B-SRSS-TB',
    wireMpn: 'SHR-{pos}V-S',
    crimpContact: 'SSHL-003T-P0.2',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST SH ${pos}-pos SMD header`,
    wireBaseName: (pos) => `JST SH ${pos}-pos housing`
  },
  {
    name: 'XH',
    pitch: '2.5 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-XH-A',
    wireMpn: 'XHP-{pos}',
    crimpContact: 'SXH-001T-P0.6',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST XH ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST XH ${pos}-pos housing`
  },
  {
    name: 'XA',
    pitch: '2.5 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-XASK-1',
    wireMpn: 'XAP-{pos}V-1',
    crimpContact: 'SXA-001T-P0.6',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST XA ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST XA ${pos}-pos housing`
  },
  {
    name: 'ZH',
    pitch: '1.5 mm',
    mountType: 'SMD',
    boardMpn: 'B{pos}B-ZR-SM4-TF',
    wireMpn: 'ZHR-{pos}',
    crimpContact: 'SZH-002T-P0.5',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST ZH ${pos}-pos SMD header`,
    wireBaseName: (pos) => `JST ZH ${pos}-pos housing`
  },
  {
    name: 'EH',
    pitch: '2.5 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-EH-A',
    wireMpn: 'EHR-{pos}',
    crimpContact: 'SEH-001T-P0.6',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST EH ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST EH ${pos}-pos housing`
  },
  {
    name: 'VH',
    pitch: '3.96 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}P-VH',
    wireMpn: 'VHR-{pos}N',
    crimpContact: 'SVH-21T-P1.1',
    positions: [2, 3, 4, 5, 6],
    boardBaseName: (pos) => `JST VH ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST VH ${pos}-pos housing`
  },
  {
    name: 'PA',
    pitch: '2.0 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-PASK-1',
    wireMpn: 'PAP-{pos}V-S',
    crimpContact: 'SPA-001T-P0.5',
    positions: [2, 3, 4, 5, 6, 7, 8],
    boardBaseName: (pos) => `JST PA ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST PA ${pos}-pos housing`
  },
  {
    name: 'RCY',
    pitch: '2.5 mm',
    mountType: 'TH',
    boardMpn: 'B{pos}B-RCYKS',
    wireMpn: 'RCY{pos}P',
    crimpContact: 'SRCY-001T-P0.6',
    positions: [2, 3],
    boardBaseName: (pos) => `JST RCY ${pos}-pos TH header`,
    wireBaseName: (pos) => `JST RCY ${pos}-pos housing`
  }
]

function padPos(pos: number): string {
  return String(pos).padStart(2, '0')
}

function makeId(prefix: string, series: string, pos: number, side: 'board' | 'wire'): string {
  return `jst-${prefix}-${series.toLowerCase()}-${padPos(pos)}-${side}`
}

function generateAll(): WireWeaverPart[] {
  const parts: WireWeaverPart[] = []

  for (const s of SERIES) {
    const prefix = s.name.toLowerCase()

    for (const pos of s.positions) {
      const posStr = padPos(pos)
      const boardId = makeId('conn', s.name, pos, 'board')
      const wireId = makeId('conn', s.name, pos, 'wire')
      const boardMpn = s.boardMpn.replace('{pos}', posStr)
      const wireMpn = s.wireMpn.replace('{pos}', posStr)

      const board: WireWeaverPart = {
        id: boardId,
        kind: 'connector',
        name: s.boardBaseName(String(pos)),
        type: 'COTS',
        internalPartNumber: `WW-CONN-${boardId}`,
        manufacturer: 'JST',
        manufacturerPartNumber: boardMpn,
        manufacturerPartUrl: `https://www.jst-mfg.com/product/detail_e.php?series=${prefix}&part=${boardMpn}`,
        supplier: 'Digi-Key',
        supplierPartNumber: boardMpn,
        notes: `${s.name} series, ${s.pitch} pitch, ${s.mountType} board-mount. Mating: ${wireMpn}. Crimp: ${s.crimpContact || '—'}`,
        positions: pos,
        gender: 'male',
        matingConnectorPartId: wireId
      }

      const wire: WireWeaverPart = {
        id: wireId,
        kind: 'connector',
        name: s.wireBaseName(String(pos)),
        type: 'COTS',
        internalPartNumber: `WW-CONN-${wireId}`,
        manufacturer: 'JST',
        manufacturerPartNumber: wireMpn,
        manufacturerPartUrl: `https://www.jst-mfg.com/product/detail_e.php?series=${prefix}&part=${wireMpn}`,
        supplier: 'Digi-Key',
        supplierPartNumber: wireMpn,
        notes: `${s.name} series, ${s.pitch} pitch, wire-side crimp housing. Mates with: ${boardMpn}. Crimp contact: ${s.crimpContact || '—'}`,
        positions: pos,
        gender: 'female',
        matingConnectorPartId: boardId
      }

      parts.push(board, wire)
    }
  }

  return parts
}

function main(): void {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/jst-connectors.wwlib')
  const parts = generateAll()
  const output = { parts, templates: [] as never[] }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} connector parts to ${outPath}\n`)
  const seriesCount = new Set(parts.map((p) => (p as any).name.split(' ')[1]))
  process.stderr.write(`  Series: ${[...seriesCount].join(', ')}\n`)
}

main()
