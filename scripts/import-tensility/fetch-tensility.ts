import * as fs from 'node:fs'
import * as path from 'node:path'

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  body_html: string
  vendor: string
  product_type: string
  tags: string | string[]
  variants: { sku: string; price: string; grams: number }[]
  published_at: string
  created_at: string
  updated_at: string
}

interface WirePart {
  id: string
  kind: 'wire'
  name: string
  type: 'COTS'
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  manufacturerPartUrl: string
  supplier: string
  supplierPartNumber: string
  supplierPartUrl?: string
  cost?: { amount: number; currency: string }
  weightGrams?: number
  notes?: string
  createdAt?: number
  updatedAt?: number
  gauge?: string
  color?: string
  conductors?: number
  shield?: boolean
  category?: 'cable' | 'bundle'
  ulStyle?: string
  jacketMaterial?: string
  voltageRating?: string
  outerDiameterMm?: number
  operatingTemperature?: string
  insulatorColor?: string
  cableStyle?: string
}

function tagSet(tags: string | string[]): Set<string> {
  const arr = Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim())
  return new Set(arr.map((t) => t.trim()).filter(Boolean))
}

function tagValue(tags: Set<string>, prefix: string): string | undefined {
  const found = [...tags].find((t) => t.startsWith(prefix))
  return found ? found.slice(prefix.length).trim() : undefined
}

function parseSpecTable(bodyHtml: string): Record<string, string> {
  const specs: Record<string, string> = {}
  const re = /<tr class="spec-data"[^>]*>\s*<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi
  let m
  while ((m = re.exec(bodyHtml)) !== null) {
    specs[m[1].trim().toLowerCase()] = m[2].trim()
  }
  return specs
}

function parseDescription(bodyHtml: string): string {
  const m = bodyHtml.match(/<h1[^>]*>\s*<span[^>]*>Description<\/span>\s*<\/h1>\s*<p[^>]*>(.*?)<\/p>/i)
    ?? bodyHtml.match(/<h1[^>]*>Description<\/h1>\s*<p[^>]*>(.*?)<\/p>/i)
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''
}

function productToWirePart(p: ShopifyProduct): WirePart {
  const tags = tagSet(p.tags)
  const specs = parseSpecTable(p.body_html)
  const desc = parseDescription(p.body_html)

  const gaugeTag = tagValue(tags, 'awg_')
  const conductorsTag = tagValue(tags, 'of-conductors_')
  const shieldTag = tagValue(tags, 'shield_')
  const colorTag = tagValue(tags, 'color_')
  const ulStyleTag = tagValue(tags, 'ul-style_')
  const jacketTag = tagValue(tags, 'jacket-material_')
  const voltageTag = tagValue(tags, 'voltage-rating_')
  const odTag = tagValue(tags, 'wire-outer-o_')
  const tempTag = tagValue(tags, 'operating-temperature_')
  const insulatorTag = tagValue(tags, 'insulator color_') ?? tagValue(tags, 'insulator-color_')
  const cableStyleTag = tagValue(tags, 'cable-style_')

  const gauge = gaugeTag ? `${gaugeTag} AWG` : (specs['awg'] ? `${specs['awg']} AWG` : undefined)
  const conductors = conductorsTag ? parseInt(conductorsTag) : (specs['# of conductors'] ? parseInt(specs['# of conductors']) : undefined)
  const shield = shieldTag ? shieldTag !== 'unshielded' : undefined
  const color = colorTag || specs['color']
  const ulStyle = ulStyleTag || specs['ul style']
  const jacketMaterial = (jacketTag || specs['jacket material'])?.toUpperCase()
  const voltageRating = voltageTag ? formatVoltageTag(voltageTag) : specs['voltage rating']
  const odStr = odTag ? formatODTag(odTag) : specs['wire outer ø']?.replace(' mm', '').replace('mm', '')
  const temp = tempTag ? formatTempTag(tempTag) : normalizeTemp(specs['operating temperature'] || '')
  const tempVal = normalizeTemp(temp || '') || undefined
  const insulatorColor = insulatorTag?.replace(/\s*\+\s*/g, ', ').replace(/-/g, '/') || specs['insulator color']
  const cableStyle = cableStyleTag || specs['cable style']
  const weightStr = specs['unit weight']?.replace('g', '').trim()

  const details: string[] = []
  if (ulStyle) details.push(`UL${ulStyle}`)
  if (jacketMaterial) details.push(jacketMaterial)
  if (voltageRating) details.push(voltageRating)
  if (tempVal) details.push(tempVal)
  if (odStr) details.push(`OD: ${odStr} mm`)
  if (specs['bend radius']) details.push(`Bend radius: ${specs['bend radius']} mm`)

  const sku = p.variants?.[0]?.sku || p.title

  return {
    id: `tensility-${sku}`,
    kind: 'wire',
    name: desc || p.title,
    type: 'COTS',
    internalPartNumber: `WW-TEN-${sku}`,
    manufacturer: 'Tensility International Corporation',
    manufacturerPartNumber: sku,
    manufacturerPartUrl: `https://www.tensility.com/products/${p.handle}`,
    supplier: 'Digi-Key',
    supplierPartNumber: sku,
    supplierPartUrl: `https://www.tensility.com/products/${p.handle}`,
    weightGrams: weightStr ? parseFloat(weightStr) : undefined,
    notes: details.length > 0 ? details.join('; ') : undefined,
    createdAt: Math.floor(new Date(p.created_at).getTime() / 1000),
    updatedAt: Math.floor(new Date(p.updated_at).getTime() / 1000),
    gauge,
    color,
    conductors,
    shield,
    category: conductors && conductors > 1 ? 'bundle' : 'cable',
    ulStyle,
    jacketMaterial,
    voltageRating,
    outerDiameterMm: odStr ? parseFloat(odStr) : undefined,
    operatingTemperature: tempVal,
    insulatorColor,
    cableStyle
  }
}

function formatODTag(tag: string): string {
  const m = tag.match(/^(\d+)-(\d+)-mm$/)
  if (m) return `${m[1]}.${m[2]}`
  return tag.replace(/-/g, ' ').replace(/mm$/, '').trim()
}

function formatVoltageTag(tag: string): string {
  return tag.replace(/-v$/i, ' V')
}

function formatTempTag(tag: string): string {
  // Strip -degc or degc suffix and any trailing dash
  let cleaned = tag.replace(/-?degc$/i, '').replace(/-$/, '')
  // Match any range: -40-80, -40~80
  const rangeMatch = cleaned.match(/^(-?\d+)[-~](\d+)$/)
  if (rangeMatch) return `${rangeMatch[1]} ~ ${rangeMatch[2]} °C`
  // Single temp
  const singleMatch = cleaned.match(/^(\d+)$/)
  if (singleMatch) return `${singleMatch[1]} °C`
  return tag
}

function normalizeTemp(raw: string): string {
  if (!raw) return raw

  // Tag-style: *degc or *-degc
  if (/degc$/i.test(raw)) return formatTempTag(raw)

  // Already normalized range
  const normRange = raw.match(/^(-?\d+)\s*~\s*(\d+)\s*°C/i)
  if (normRange) return `${normRange[1]} ~ ${normRange[2]} °C`

  return raw
}

async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'WireWeaver/1.0 (library-import)',
        'Accept': 'application/json'
      }
    })
    if (resp.status === 429) {
      const wait = Math.pow(2, i + 1) * 1000
      process.stderr.write(`rate limited, waiting ${wait / 1000}s... `)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    return resp
  }
  throw new Error(`HTTP 429 after ${retries} retries`)
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const BASE = 'https://www.tensility.com/products.json'
  const PER_PAGE = 250
  const products: ShopifyProduct[] = []
  let page = 1

  while (true) {
    process.stderr.write(`Fetching page ${page}... `)
    const url = `${BASE}?limit=${PER_PAGE}&page=${page}&product_type=Wire`
    let resp: Response
    try {
      resp = await fetchWithRetry(url)
    } catch (e) {
      process.stderr.write(`fetch error: ${e}\n`)
      break
    }
    if (!resp.ok) {
      process.stderr.write(`HTTP ${resp.status}, stopping.\n`)
      break
    }
    const json = await resp.json() as { products?: ShopifyProduct[] }
    const batch = json.products ?? []
    if (batch.length === 0) {
      process.stderr.write(`empty page, done.\n`)
      break
    }

    const wires = batch.filter((b) => {
      const ts = tagSet(b.tags)
      return ts.has('Product Group_30')
    })

    products.push(...wires)
    process.stderr.write(`got ${batch.length} products, ${wires.length} wire spools (total ${products.length})\n`)

    if (batch.length < PER_PAGE) {
      process.stderr.write('Last page reached.\n')
      break
    }
    page++
    await new Promise((r) => setTimeout(r, 2000))
  }

  return products
}

async function main(): Promise<void> {
  const outPath = process.argv[2] || path.resolve(__dirname, '../../data/tensility-wires.wwlib')

  process.stderr.write('Fetching Tensility wire spool products...\n')
  const products = await fetchAllProducts()
  process.stderr.write(`\nFetched ${products.length} wire spool products total.\n`)
  process.stderr.write('Parsing products into WirePart entries...\n')

  const parts: WirePart[] = products.map(productToWirePart)

  const output = { parts, templates: [] as never[] }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  process.stderr.write(`Wrote ${parts.length} wire parts to ${outPath}\n`)

  const conductors = new Set<number>()
  const gauges = new Set<string>()
  for (const p of parts) {
    if (p.conductors != null) conductors.add(p.conductors)
    if (p.gauge) gauges.add(p.gauge)
  }
  process.stderr.write(`  Conductor counts: ${[...conductors].sort((a, b) => a - b).join(', ')}\n`)
  process.stderr.write(`  Gauges: ${[...gauges].sort().join(', ')}\n`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
