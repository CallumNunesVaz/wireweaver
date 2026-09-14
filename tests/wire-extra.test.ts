import { describe, it, expect } from 'vitest'
import {
  T568A_COLORS,
  T568B_COLORS,
  awgToMm2,
  codeColor,
  codeSequence,
  mm2ToAwg,
  parseGauge,
  parseStripedColor,
  renderStripedColor
} from '../src/model/wire'

describe('striped colours', () => {
  it('parses a two-colour abbreviation', () => {
    expect(parseStripedColor('WH/GN')).toEqual({ primary: '#ffffff', secondary: '#00cc00' })
  })

  it('returns null for malformed or unknown colours', () => {
    expect(parseStripedColor('WH')).toBeNull()
    expect(parseStripedColor('WH/GN/RD')).toBeNull()
    expect(parseStripedColor('ZZ/GN')).toBeNull()
  })

  it('renders a repeating gradient containing both colours', () => {
    const css = renderStripedColor({ primary: '#ffffff', secondary: '#00cc00' })
    expect(css).toContain('repeating-linear-gradient')
    expect(css).toContain('#ffffff')
    expect(css).toContain('#00cc00')
  })
})

describe('colour codes', () => {
  it('sequences T568A and T568B pin colours', () => {
    expect(codeSequence('T568A', 8)).toEqual(T568A_COLORS)
    expect(codeSequence('T568B', 8)).toEqual(T568B_COLORS)
  })

  it('resolves combined abbreviations', () => {
    expect(codeColor('GNWT')).toBe('#00cc00')
    expect(codeColor('OGWH')).toBe('#ff8000')
  })
})

describe('gauge edge cases', () => {
  it('returns NaN / null for non-positive values', () => {
    expect(Number.isNaN(awgToMm2(0))).toBe(true)
    expect(mm2ToAwg(0)).toBeNull()
  })

  it('passes unknown gauge strings through', () => {
    const g = parseGauge('braided 3mm')
    expect(g.label).toBe('braided 3mm')
    expect(g.awg).toBeUndefined()
    expect(g.mm2).toBeUndefined()
  })

  it('round-trips a handful of AWG sizes', () => {
    for (const awg of [10, 18, 22, 26, 30]) {
      expect(mm2ToAwg(awgToMm2(awg))).toBe(awg)
    }
  })
})
