import Decimal from 'decimal.js'
import type { BomRow } from './bom'

/** EUR-referenced FX rates plus their provenance, as returned by fetchRates. */
export interface FxRates {
  /** ISO 8601 publication date (frankfurter's `date`); '' when the API omits it. */
  date: string
  /** Human-readable source of the rates. */
  source: string
  /** Currency code → units per EUR (EUR is always 1). */
  rates: Record<string, number>
}

const RATE_SOURCE = 'Frankfurter (api.frankfurter.dev)'

let ratesCache: FxRates | null = null

export async function fetchRates(): Promise<FxRates | null> {
  if (ratesCache) return ratesCache

  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://api.frankfurter.dev/v1/latest', { signal: controller.signal })
    clearTimeout(id)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // API shape is flagged as uncertain: frankfurter returns
    // { amount, base, date, rates }. Parse defensively so a changed payload
    // degrades to `null` rather than throwing on the caller.
    const data = (await res.json()) as { date?: unknown; rates?: unknown } | null
    const rates: Record<string, number> = { EUR: 1 }
    if (data && typeof data.rates === 'object' && data.rates !== null) {
      for (const [code, value] of Object.entries(data.rates as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) rates[code] = value
      }
    }
    const result: FxRates = {
      date: data && typeof data.date === 'string' ? data.date : '',
      source: RATE_SOURCE,
      rates
    }
    ratesCache = result
    return result
  } catch {
    return null
  }
}

export function clearRateCache(): void {
  ratesCache = null
}

export async function convertBomTotals(
  rows: BomRow[],
  targetCurrency: string
): Promise<{ convertedCost: number; rate: number } | null> {
  const fetched = await fetchRates()
  if (!fetched) return null
  const rates = fetched.rates
  const rate = rates[targetCurrency]
  if (!rate) return null

  let total = new Decimal(0)
  for (const r of rows) {
    if (!r.cost) continue
    const rowCurrency = r.cost.currency
    const fromRate = rates[rowCurrency]
    if (!fromRate) continue
    const eur = new Decimal(r.cost.amount).div(new Decimal(fromRate))
    const converted = eur.times(new Decimal(rate)).times(r.quantity)
    total = total.plus(converted)
  }

  return { convertedCost: total.toNumber(), rate }
}
