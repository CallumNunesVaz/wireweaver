import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CURRENCIES, formatMoney } from '../src/model/currency'
import { clearRateCache, convertBomTotals, fetchRates } from '../src/model/fx'
import type { BomRow } from '../src/model/bom'

const rows: BomRow[] = [
  {
    category: 'device',
    name: 'A',
    ipn: '',
    manufacturer: '',
    mpn: '',
    quantity: 2,
    cost: { amount: 10, currency: 'USD' }
  },
  {
    category: 'connector',
    name: 'B',
    ipn: '',
    manufacturer: '',
    mpn: '',
    quantity: 1,
    cost: { amount: 5, currency: 'EUR' }
  }
]

describe('currency', () => {
  it('formats a known currency', () => {
    const s = formatMoney({ amount: 12.5, currency: 'USD' })
    expect(s).toContain('12.5')
    expect(s).not.toContain('—')
  })

  it('falls back to a plain string for codes Intl rejects', () => {
    // Intl requires a 3-letter ISO 4217 code; 'US' throws and hits the fallback.
    expect(formatMoney({ amount: 3, currency: 'US' })).toBe('3 US')
  })

  it('renders a dash when there is no money', () => {
    expect(formatMoney(undefined)).toBe('—')
  })

  it('exposes a broad currency list with unique codes', () => {
    const codes = CURRENCIES.map((c) => c.code)
    expect(codes).toContain('USD')
    expect(codes).toContain('AUD')
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('fx', () => {
  beforeEach(() => clearRateCache())
  afterEach(() => vi.unstubAllGlobals())

  it('fetches rates and caches them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ rates: { USD: 1.1, AUD: 1.6 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const rates = await fetchRates()
    expect(rates).toEqual({ EUR: 1, USD: 1.1, AUD: 1.6 })
    await fetchRates()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchRates()).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await fetchRates()).toBeNull()
  })

  it('converts BOM totals into the target currency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { USD: 1.1 } }) })
    )
    const res = await convertBomTotals(rows, 'USD')
    // USD: 10 / 1.1 × 1.1 × 2 = 20; EUR: 5 × 1.1 = 5.5 → 25.5
    expect(res).not.toBeNull()
    expect(res!.convertedCost).toBeCloseTo(25.5, 6)
    expect(res!.rate).toBe(1.1)
  })

  it('returns null for an unknown target currency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { USD: 1.1 } }) })
    )
    expect(await convertBomTotals(rows, 'ZZZ')).toBeNull()
  })

  it('skips rows whose currency has no rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { USD: 1.1 } }) })
    )
    const gbp: BomRow[] = [
      {
        category: 'wire',
        name: 'C',
        ipn: '',
        manufacturer: '',
        mpn: '',
        quantity: 1,
        cost: { amount: 10, currency: 'GBP' }
      }
    ]
    const res = await convertBomTotals(gbp, 'USD')
    expect(res!.convertedCost).toBe(0)
  })
})
