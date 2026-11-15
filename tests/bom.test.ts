import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildBom, bomTotals, toCsv, exportBomCsv, type BomRow } from '../src/model/bom'
import { lib, project, clone } from './fixtures'

describe('buildBom', () => {
  it('counts placed devices, derived connectors and assigned wire parts', () => {
    const rows = buildBom(project, lib)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName['Flight Controller'].quantity).toBe(3)
    expect(byName['JST GH 4-pos'].quantity).toBe(2)
    expect(byName['Hookup 22AWG'].quantity).toBe(2)
  })

  it('counts accessories with their quantity and re-categorises the part', () => {
    const p = clone(project)
    p.harnesses[0].accessories = [
      { id: 'a1', partId: 'conn1', category: 'backshell', quantity: 2 }
    ]
    const byName = Object.fromEntries(buildBom(p, lib).map((r) => [r.name, r]))
    expect(byName['JST GH 4-pos'].quantity).toBe(4)
    expect(byName['JST GH 4-pos'].category).toBe('accessory')
  })

  it('adds a generic splice row and counts assigned splice wire parts', () => {
    const p = clone(project)
    p.harnesses[0].splices = [
      { id: 's1', name: 'S1', wireIds: ['w1', 'w2'] },
      { id: 's2', name: 'S2', wireIds: ['w1', 'w2'], wirePartId: 'wire1' }
    ]
    const byName = Object.fromEntries(buildBom(p, lib).map((r) => [r.name, r]))
    expect(byName['Generic Splice'].quantity).toBe(1)
    expect(byName['Hookup 22AWG'].quantity).toBe(3)
  })

  it('skips parts that are not in the library', () => {
    const p = clone(project)
    p.deviceInstances.push({ id: 'i9', partId: 'ghost', label: 'Ghost', position: { x: 0, y: 0 } })
    expect(buildBom(p, lib).some((r) => r.name === 'Ghost')).toBe(false)
  })
})

describe('bomTotals / toCsv', () => {
  const rows: BomRow[] = [
    {
      category: 'device',
      name: 'A',
      ipn: 'IPN-A',
      manufacturer: 'M',
      mpn: 'MPN-A',
      quantity: 2,
      cost: { amount: 10, currency: 'USD' },
      weightGrams: 30
    },
    {
      category: 'wire',
      name: 'W, with comma',
      ipn: '',
      manufacturer: '',
      mpn: '',
      quantity: 1,
      cost: { amount: 0.5, currency: 'USD' }
    }
  ]

  it('sums weight and per-currency cost', () => {
    const t = bomTotals(rows)
    expect(t.weightGrams).toBe(60)
    expect(t.costByCurrency.get('USD')).toBeCloseTo(20.5)
  })

  it('serialises rows, escapes commas and appends totals', () => {
    const csv = toCsv(rows)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Category,Name,Internal PN')
    expect(csv).toContain('"W, with comma"')
    expect(csv).toContain('Total weight (g),60')
    expect(csv).toContain('Total cost (USD)')
  })
})

describe('toCsv with currency conversion', () => {
  const rates: Record<string, number> = { EUR: 1, USD: 1.1, GBP: 0.85, JPY: 160 }

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
      category: 'wire',
      name: 'B',
      ipn: '',
      manufacturer: '',
      mpn: '',
      quantity: 1,
      cost: { amount: 5, currency: 'EUR' }
    },
    {
      category: 'connector',
      name: 'C',
      ipn: '',
      manufacturer: '',
      mpn: '',
      quantity: 3,
      cost: { amount: 2, currency: 'ZZZ' }
    },
    {
      category: 'wire',
      name: 'D',
      ipn: '',
      manufacturer: '',
      mpn: '',
      quantity: 1
    }
  ]

  it('adds converted columns and a single converted total', () => {
    const csv = toCsv(rows, {
      currency: 'USD',
      rates,
      rateDate: '2024-01-02',
      rateSource: 'Frankfurter'
    })
    const header = csv.split('\n')[0]
    expect(header).toContain('Unit Cost (USD)')
    expect(header).toContain('Ext Cost (USD)')
    expect(csv).toContain('10.00,20.00')
    expect(csv).toContain('5.50,5.50')
    expect(csv).toContain('Converted total (USD),25.50')
    expect(csv).toContain('Rates as of,2024-01-02')
    expect(csv).toContain('Rate source,Frankfurter')
  })

  it('leaves rows without a rate empty and lists them in the footer', () => {
    const csv = toCsv(rows, { currency: 'USD', rates })
    expect(csv).toContain('Not converted: C')
    expect(csv).not.toContain('Not converted: A')
    expect(csv).not.toContain('Not converted: D')
  })

  it('rounds JPY to 0 decimal places', () => {
    const jpyRows: BomRow[] = [
      {
        category: 'wire',
        name: 'J',
        ipn: '',
        manufacturer: '',
        mpn: '',
        quantity: 1,
        cost: { amount: 0.1, currency: 'USD' }
      }
    ]
    const csv = toCsv(jpyRows, { currency: 'JPY', rates })
    expect(csv).toContain('Converted total (JPY),15')
    expect(csv).toContain(',15,15')
  })

  it('keeps the original output when no conversion is requested', () => {
    const csv = toCsv(rows)
    expect(csv).not.toContain('Unit Cost (USD)')
    expect(csv).not.toContain('Converted total')
  })
})

describe('exportBomCsv', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('delegates to the bridge and returns its result', async () => {
    const exportMock = vi.fn().mockResolvedValue({ canceled: false, path: '/tmp/bom.csv' })
    vi.stubGlobal('window', { ww: { file: { exportText: exportMock } } })
    const res = await exportBomCsv(project, lib)
    expect(exportMock).toHaveBeenCalledOnce()
    expect(exportMock.mock.calls[0][0]).toMatchObject({ filterName: 'CSV', extensions: ['csv'] })
    expect(res.path).toBe('/tmp/bom.csv')
  })

  it('reports errors from the bridge', async () => {
    vi.stubGlobal('window', {
      ww: {
        file: {
          exportText: vi.fn().mockRejectedValue(new Error('disk full'))
        }
      }
    })
    const res = await exportBomCsv(project, lib)
    expect(res.error).toContain('disk full')
  })
})

describe('toCsv conversion rounding', () => {
  it('grand total equals the sum of the rounded converted line values', () => {
    const rows = [1, 2, 3].map((i) => ({
      category: 'device',
      name: `P${i}`,
      ipn: '',
      manufacturer: '',
      mpn: '',
      quantity: 1,
      cost: { amount: 0.335, currency: 'EUR' },
      weightGrams: undefined
    }))
    const csv = toCsv(rows as never, { currency: 'USD', rates: { EUR: 1, USD: 1.0 } })
    const lines = csv.split('\n')
    const ext = lines.slice(1, 4).map((l) => Number(l.split(',').pop()))
    expect(ext).toEqual([0.34, 0.34, 0.34])
    expect(lines.find((l) => l.startsWith('Converted total'))).toBe('Converted total (USD),1.02')
  })
})
