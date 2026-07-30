import type { Money, Project } from './types'
import type { LibraryLike } from './derivation'
import { resolveEndpoint } from './derivation'
import { formatMoney } from './currency'

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

export function toCsv(rows: BomRow[]): string {
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
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.join(',')]
  for (const r of rows) {
    const ext = r.cost
      ? formatMoney({ amount: r.cost.amount * r.quantity, currency: r.cost.currency })
      : '—'
    lines.push(
      [
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
        .map(esc)
        .join(',')
    )
  }

  const totals = bomTotals(rows)
  lines.push('')
  lines.push(`Total weight (g),${totals.weightGrams}`)
  for (const [currency, amount] of totals.costByCurrency) {
    lines.push(`Total cost (${currency}),${esc(formatMoney({ amount, currency }))}`)
  }
  return lines.join('\n')
}

export async function exportBomCsv(
  project: Project,
  lib: LibraryLike
): Promise<{ canceled: boolean; path?: string; error?: string }> {
  try {
    const csv = toCsv(buildBom(project, lib))
    return window.ww.bom.export(csv, `${project.name || 'wireweaver'}-bom.csv`)
  } catch (e) {
    return { canceled: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}
