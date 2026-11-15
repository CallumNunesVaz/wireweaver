import Decimal from 'decimal.js'
import type { Money, Project } from './types'
import { csvCell } from './csv'
import type { LibraryLike } from './derivation'
import { resolveEndpoint } from './derivation'
import { currencyDecimals, formatMoney } from './currency'

export interface BomRow {
  category: string
  name: string
  ipn: string
  manufacturer: string
  mpn: string
  quantity: number
  cost?: Money
  weightGrams?: number
}

export interface BomTotals {
  weightGrams: number
  /** Summed per ISO currency — no FX conversion in v1. */
  costByCurrency: Map<string, number>
}

export function bomTotals(rows: BomRow[]): BomTotals {
  let weightGrams = 0
  const costByCurrency = new Map<string, number>()
  for (const r of rows) {
    weightGrams += (r.weightGrams ?? 0) * r.quantity
    if (r.cost) {
      costByCurrency.set(
        r.cost.currency,
        (costByCurrency.get(r.cost.currency) ?? 0) + r.cost.amount * r.quantity
      )
    }
  }
  return { weightGrams, costByCurrency }
}

/** Roll up devices, connectors and wires used in a project into BOM rows. */
export function buildBom(project: Project, lib: LibraryLike): BomRow[] {
  const counts = new Map<string, { qty: number }>()
  const bump = (partId: string) => {
    const c = counts.get(partId) ?? { qty: 0 }
    c.qty += 1
    counts.set(partId, c)
  }

  // Devices from instances.
  for (const inst of project.deviceInstances) bump(inst.partId)

  // Connectors: one per harness endpoint, derived from ports.
  for (const h of project.harnesses) {
    for (const ep of h.endpoints) {
      const re = resolveEndpoint(lib, project.deviceInstances, ep)
      if (re?.connector) bump(re.connector.id)
    }
    // Wire parts assigned to individual wires.
    for (const w of h.wires) if (w.wirePartId) bump(w.wirePartId)

    // Accessories (Feature 5)
    for (const acc of h.accessories ?? []) {
      const c = counts.get(acc.partId) ?? { qty: 0 }
      c.qty += acc.quantity
      counts.set(acc.partId, c)
    }

    // Splices (Feature 6)
    for (const splice of h.splices ?? []) {
      if (splice.wirePartId) {
        bump(splice.wirePartId)
      } else {
        // Generic splice counts as 1 connector part equivalent
        const genericId = '__generic_splice__'
        const c = counts.get(genericId) ?? { qty: 0 }
        c.qty += 1
        counts.set(genericId, c)
      }
    }
  }

  const accessoryPartIds = new Set<string>()
  for (const h of project.harnesses) {
    for (const acc of h.accessories ?? []) accessoryPartIds.add(acc.partId)
  }

  const rows: BomRow[] = []
  for (const [partId, { qty }] of counts) {
    if (partId === '__generic_splice__') {
      rows.push({
        category: 'accessory',
        name: 'Generic Splice',
        ipn: '—',
        manufacturer: '—',
        mpn: '—',
        quantity: qty
      })
      continue
    }
    const part = lib.parts[partId]
    if (!part) continue
    const category = accessoryPartIds.has(partId)
      ? 'accessory'
      : part.kind === 'connector'
        ? 'connector'
        : part.kind
    rows.push({
      category,
      name: part.name,
      ipn: part.internalPartNumber,
      manufacturer: part.manufacturer,
      mpn: part.manufacturerPartNumber,
      quantity: qty,
      cost: part.cost,
      weightGrams: part.weightGrams
    })
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return rows
}

export interface ToCsvOptions {
  /** Target ISO currency for the converted columns; omit to export per-currency totals. */
  currency?: string
  /** EUR-referenced FX rates (currency code → units per EUR). */
  rates?: Record<string, number>
  /** Publication date of `rates`, written to the footer. */
  rateDate?: string
  /** Human-readable source of `rates`, written to the footer. */
  rateSource?: string
}

export function toCsv(rows: BomRow[], options: ToCsvOptions = {}): string {
  const { currency, rates, rateDate, rateSource } = options
  const convert = !!currency && !!rates
  const targetRate = convert ? rates[currency] : undefined
  const targetDecimals = convert ? currencyDecimals(currency) : 2

  const header = [
    'Category',
    'Name',
    'Internal PN',
    'Manufacturer',
    'MPN',
    'Qty',
    'Unit Cost',
    'Ext Cost',
    'Weight (g)'
  ]
  if (convert) header.push(`Unit Cost (${currency})`, `Ext Cost (${currency})`)

  const esc = csvCell
  const lines = [header.join(',')]
  const notConverted: string[] = []
  // The grand total is the sum of the rounded line values the reader sees, so
  // the column always adds up exactly.
  let convertedTotal = new Decimal(0)

  for (const r of rows) {
    const ext = r.cost
      ? formatMoney({ amount: r.cost.amount * r.quantity, currency: r.cost.currency })
      : '—'
    const cells: (string | number)[] = [
      r.category,
      r.name,
      r.ipn,
      r.manufacturer,
      r.mpn,
      r.quantity,
      formatMoney(r.cost ?? { amount: 0, currency: 'USD' }),
      ext,
      r.weightGrams ?? ''
    ]
    if (convert) {
      const rowCurrency = r.cost?.currency
      const fromRate = rowCurrency ? rates[rowCurrency] : undefined
      if (rowCurrency && fromRate && targetRate) {
        const unit = new Decimal(r.cost!.amount)
          .div(new Decimal(fromRate))
          .times(new Decimal(targetRate))
        const extRounded = unit.times(r.quantity).toDecimalPlaces(targetDecimals, Decimal.ROUND_HALF_UP)
        convertedTotal = convertedTotal.plus(extRounded)
        cells.push(
          unit.toDecimalPlaces(targetDecimals, Decimal.ROUND_HALF_UP).toFixed(targetDecimals),
          extRounded.toFixed(targetDecimals)
        )
      } else if (rowCurrency) {
        // A priced row whose currency has no rate: empty converted cells, and
        // recorded in the footer so the reader knows it was left out.
        cells.push('', '')
        notConverted.push(r.name)
      } else {
        cells.push('', '')
      }
    }
    lines.push(cells.map(esc).join(','))
  }

  const totals = bomTotals(rows)
  lines.push('')
  lines.push(`Total weight (g),${totals.weightGrams}`)
  for (const [cur, amount] of totals.costByCurrency) {
    lines.push(`Total cost (${cur}),${esc(formatMoney({ amount, currency: cur }))}`)
  }

  if (convert && targetRate) {
    lines.push(`Converted total (${currency}),${esc(convertedTotal.toFixed(targetDecimals))}`)
  }
  if (convert) {
    if (rateDate) lines.push(`Rates as of,${esc(rateDate)}`)
    if (rateSource) lines.push(`Rate source,${esc(rateSource)}`)
    if (notConverted.length > 0) {
      lines.push(esc(`Not converted: ${notConverted.join(', ')}`))
    }
  }

  return lines.join('\n')
}

export async function exportBomCsv(
  project: Project,
  lib: LibraryLike
): Promise<{ canceled: boolean; path?: string; error?: string }> {
  try {
    const csv = toCsv(buildBom(project, lib))
    // Await so a rejected bridge call is caught rather than escaping the try.
    return await window.ww.file.exportText({
      content: csv,
      defaultName: `${project.name || 'wireweaver'}-bom.csv`,
      filterName: 'CSV',
      extensions: ['csv']
    })
  } catch (e) {
    return { canceled: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}
