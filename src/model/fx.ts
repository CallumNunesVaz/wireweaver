import Decimal from 'decimal.js'
import type { BomRow } from './bom'

let ratesCache: Record<string, number> | null = null

export async function fetchRates(): Promise<Record<string, number> | null> {
  if (ratesCache) return ratesCache

  try {
    const res = await fetch('https://api.frankfurter.app/latest')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const rates: Record<string, number> = {
      EUR: 1,
      ...(data.rates ?? {})
    }
    ratesCache = rates
    return rates
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
  const rates = await fetchRates()
  if (!rates) return null
  const rate = rates[targetCurrency]
  if (!rate) return null

  let total = new Decimal(0)
  for (const r of rows) {
    if (!r.cost) continue
    const rowCurrency = r.cost.currency
    const fromRate = rates[rowCurrency]
    if (!fromRate) return null
    const eur = new Decimal(r.cost.amount).div(new Decimal(fromRate))
    const converted = eur.times(new Decimal(rate)).times(r.quantity)
    total = total.plus(converted)
  }

  return { convertedCost: total.toNumber(), rate }
}
