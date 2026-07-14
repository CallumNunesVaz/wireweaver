import { describe, it, expect } from 'vitest'
import {
  codeSequence,
  codeColor,
  awgToMm2,
  mm2ToAwg,
  parseGauge,
  formatGauge,
  DIN_COLORS
} from '../src/model/wire'

describe('codeSequence', () => {
  it('returns the first n colors of the code', () => {
    expect(codeSequence('DIN', 4)).toEqual(['WH', 'BN', 'GN', 'YE'])
  })

  it('repeats the sequence when count exceeds its length', () => {
    const seq = codeSequence('DIN', DIN_COLORS.length + 2)
    expect(seq[DIN_COLORS.length]).toBe(DIN_COLORS[0])
    expect(seq[DIN_COLORS.length + 1]).toBe(DIN_COLORS[1])
  })
})

describe('codeColor', () => {
  it('maps known abbreviations and falls back to grey', () => {
    expect(codeColor('RD')).toBe('#ff0000')
    expect(codeColor('ZZ')).toBe('#888888')
  })
})

describe('gauge conversion', () => {
  it('converts common AWG sizes to mm²', () => {
    expect(awgToMm2(22)).toBeCloseTo(0.33, 1)
    expect(awgToMm2(28)).toBeCloseTo(0.08, 1)
  })

  it('round-trips mm² back to a nearby AWG', () => {
    const awg = mm2ToAwg(awgToMm2(22))
    expect(awg).toBe(22)
  })
})

describe('parseGauge / formatGauge', () => {
  it('parses AWG strings', () => {
    const g = parseGauge('22 AWG')
    expect(g.awg).toBe(22)
    expect(g.mm2).toBeGreaterThan(0)
  })

  it('parses mm² strings in both spellings', () => {
    expect(parseGauge('0.34 mm2').mm2).toBe(0.34)
    expect(parseGauge('0.34 mm²').mm2).toBe(0.34)
  })

  it('leads with the given unit and passes unknown strings through', () => {
    expect(formatGauge('22 AWG')).toMatch(/^22 AWG \(≈ .+ mm²\)$/)
    expect(formatGauge('0.34 mm²')).toMatch(/^0\.34 mm² \(≈ \d+ AWG\)$/)
    expect(formatGauge('braided 3mm')).toBe('braided 3mm')
    expect(formatGauge()).toBe('')
  })
})
