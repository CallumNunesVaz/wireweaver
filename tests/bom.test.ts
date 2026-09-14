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

describe('exportBomCsv', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('delegates to the bridge and returns its result', async () => {
    const exportMock = vi.fn().mockResolvedValue({ canceled: false, path: '/tmp/bom.csv' })
    vi.stubGlobal('window', { ww: { bom: { export: exportMock } } })
    const res = await exportBomCsv(project, lib)
    expect(exportMock).toHaveBeenCalledOnce()
    expect(res.path).toBe('/tmp/bom.csv')
  })

  it('reports errors from the bridge', async () => {
    vi.stubGlobal('window', {
      ww: {
        bom: {
          export: vi.fn().mockRejectedValue(new Error('disk full'))
        }
      }
    })
    const res = await exportBomCsv(project, lib)
    expect(res.error).toContain('disk full')
  })
})
