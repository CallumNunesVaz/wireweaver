import { describe, it, expect } from 'vitest'
import { isValidWireConnection, wiredPositionsByEnd } from '../src/model/wiring'
import type { HarnessWire } from '../src/model/types'

const wire = (
  id: string,
  fromEnd: string,
  fromPos: number,
  toEnd: string,
  toPos: number
): HarnessWire => ({ id, from: { end: fromEnd, position: fromPos }, to: { end: toEnd, position: toPos } })

describe('wiredPositionsByEnd', () => {
  it('records every wired pin per endpoint', () => {
    const wires = [wire('w1', 'a', 1, 'b', 2), wire('w2', 'a', 3, 'c', 1)]
    const wired = wiredPositionsByEnd(wires, 3)
    expect([...wired.a]).toEqual([1, 3])
    expect([...wired.b]).toEqual([2])
    expect([...wired.c]).toEqual([1])
  })

  it('returns empty sets for a fresh harness', () => {
    const wired = wiredPositionsByEnd([], 2)
    expect([...wired.a]).toEqual([])
    expect([...wired.b]).toEqual([])
  })
})

describe('isValidWireConnection', () => {
  const wires = [wire('w1', 'a', 1, 'b', 1)]

  it('allows two free pins', () => {
    expect(isValidWireConnection(wires, { end: 'a', position: 2 }, { end: 'b', position: 2 })).toBe(
      true
    )
  })

  it('rejects a self-pin (same end and position)', () => {
    expect(isValidWireConnection(wires, { end: 'a', position: 2 }, { end: 'a', position: 2 })).toBe(
      false
    )
  })

  it('rejects a pin that is already wired on the from side', () => {
    expect(isValidWireConnection(wires, { end: 'a', position: 1 }, { end: 'b', position: 2 })).toBe(
      false
    )
  })

  it('rejects a pin that is already wired on the to side', () => {
    expect(isValidWireConnection(wires, { end: 'a', position: 2 }, { end: 'b', position: 1 })).toBe(
      false
    )
  })

  it('allows same end with different positions (as the drag path does)', () => {
    expect(isValidWireConnection(wires, { end: 'a', position: 2 }, { end: 'a', position: 3 })).toBe(
      true
    )
  })
})
