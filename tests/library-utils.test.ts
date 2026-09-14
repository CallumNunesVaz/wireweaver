import { describe, it, expect } from 'vitest'
import { fuzzySearch } from '../src/library/FuzzySearch'
import { SIGNAL_CLASSES, signalColor } from '../src/shared/signal'
import { parts } from './fixtures'

describe('fuzzySearch', () => {
  it('returns the original array for a blank query', () => {
    expect(fuzzySearch(parts, '')).toBe(parts)
    expect(fuzzySearch(parts, '   ')).toBe(parts)
  })

  it('matches by name', () => {
    expect(fuzzySearch(parts, 'Flight').map((p) => p.id)).toContain('dev1')
  })

  it('matches by manufacturer part number', () => {
    expect(fuzzySearch(parts, 'GHR-04V').map((p) => p.id)).toContain('conn1')
  })

  it('matches by internal part number', () => {
    expect(fuzzySearch(parts, 'IPN-WIRE-2').map((p) => p.id)).toContain('bundle1')
  })

  it('rebuilds its index when a new parts array is supplied', () => {
    fuzzySearch(parts, 'Flight')
    const next = [...parts]
    expect(fuzzySearch(next, 'Hookup').map((p) => p.id)).toContain('wire1')
    // The original array still searches correctly.
    expect(fuzzySearch(parts, 'Hookup').map((p) => p.id)).toContain('wire1')
  })

  it('returns nothing for nonsense queries', () => {
    expect(fuzzySearch(parts, 'qqqqzzzz')).toEqual([])
  })
})

describe('signal colours', () => {
  it('maps every signal class to a distinct colour', () => {
    const colours = ['power', 'ground', 'data', 'shield', 'nc'].map((c) =>
      signalColor(c as never)
    )
    expect(new Set(colours).size).toBe(colours.length)
    expect(signalColor('power')).toBe('#e5484d')
    expect(signalColor('ground')).toBe('#8b8f98')
    expect(signalColor('data')).toBe('#5b9bff')
    expect(signalColor('shield')).toBe('#c48a2f')
    expect(signalColor('nc')).toBe('#4a4f5a')
  })

  it('falls back for an unclassified signal', () => {
    expect(signalColor(undefined)).toBe('#7a808c')
  })

  it('lists every signal class in order', () => {
    expect(SIGNAL_CLASSES.map((c) => c.value)).toEqual([
      'power',
      'ground',
      'data',
      'shield',
      'nc'
    ])
  })
})
