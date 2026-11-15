/**
 * Pure wiring planners shared by the app (Harness Editor) and the
 * programmatic API / MCP server. Each function returns new data and never
 * mutates its inputs, so callers decide how to commit (store action, undo
 * step, or in-place API mutation).
 */
import { nanoid } from 'nanoid'
import type { HarnessSplice, HarnessWire, PinDef, WirePart } from './types'
import { endLabel } from './types'
import type { ResolvedEndpoint } from './derivation'
import { codeColor, codeSequence } from './wire'

const SHIELD_COLOR = '#84878c'

function pinKey(end: string, position: number): string {
  return `${end}:${position}`
}

function usedPins(wires: HarnessWire[]): Set<string> {
  const used = new Set<string>()
  for (const w of wires) {
    used.add(pinKey(w.from.end, w.from.position))
    used.add(pinKey(w.to.end, w.to.position))
  }
  return used
}

/** Wired pin positions per endpoint label, for disabling already-wired pins. */
export function wiredPositionsByEnd(
  wires: HarnessWire[],
  endpointCount: number
): Record<string, Set<number>> {
  const all: Record<string, Set<number>> = {}
  for (let i = 0; i < endpointCount; i++) all[endLabel(i)] = new Set<number>()
  for (const w of wires) {
    all[w.from.end]?.add(w.from.position)
    all[w.to.end]?.add(w.to.position)
  }
  return all
}

/** Whether a proposed wire is allowed: not a self-pin, and neither pin already wired. */
export function isValidWireConnection(
  wires: HarnessWire[],
  from: { end: string; position: number },
  to: { end: string; position: number }
): boolean {
  if (from.end === to.end && from.position === to.position) return false
  const isWired = (end: string, position: number) =>
    wires.some(
      (w) =>
        (w.from.end === end && w.from.position === position) ||
        (w.to.end === end && w.to.position === position)
    )
  return !isWired(from.end, from.position) && !isWired(to.end, to.position)
}

const norm = (p: PinDef): string => p.signal.trim().toLowerCase()

/**
 * Wire endpoint columns by matching pin signal names. Only neighbouring
 * endpoints are paired unless `allPairs` is set (star wiring). Pins that are
 * already wired, unnamed or no-connect are skipped.
 */
export function planAutoWire(
  resolved: Map<string, ResolvedEndpoint>,
  endpointCount: number,
  existing: HarnessWire[],
  opts: { allPairs?: boolean } = {}
): HarnessWire[] {
  const used = usedPins(existing)
  const added: HarnessWire[] = []
  for (let i = 0; i < endpointCount; i++) {
    for (let j = i + 1; j < endpointCount; j++) {
      if (!opts.allPairs && j !== i + 1) continue
      const la = endLabel(i)
      const lb = endLabel(j)
      const ra = resolved.get(la)
      const rb = resolved.get(lb)
      if (!ra || !rb) continue
      for (const pa of ra.pins) {
        const sa = norm(pa)
        if (!sa || pa.signalClass === 'nc' || used.has(pinKey(la, pa.position))) continue
        const match = rb.pins.find(
          (pb) => norm(pb) === sa && pb.signalClass !== 'nc' && !used.has(pinKey(lb, pb.position))
        )
        if (!match) continue
        added.push({
          id: nanoid(),
          from: { end: la, position: pa.position },
          to: { end: lb, position: match.position }
        })
        used.add(pinKey(la, pa.position))
        used.add(pinKey(lb, match.position))
      }
    }
  }
  return added
}

/** Conductor colours and labels for a cable, honouring its colour code. */
export function conductorStyles(
  wirePart: WirePart
): { color: string | undefined; label: string | undefined }[] {
  const n = Math.max(1, wirePart.conductors ?? 1)
  if (wirePart.colorCode) {
    const seq = codeSequence(wirePart.colorCode, n)
    return seq.map((abbr) => ({ color: codeColor(abbr), label: abbr }))
  }
  return Array.from({ length: n }, () => ({ color: wirePart.color, label: undefined }))
}

/**
 * Assign a wire part to one existing wire. A single-conductor part simply
 * takes over the wire. For a multi-conductor cable the wire becomes the next
 * free conductor of that cable on the same endpoint pair (taking its colour
 * and label) instead of being cloned once per conductor onto one pin pair.
 */
export function assignWirePart(
  wires: HarnessWire[],
  wireId: string,
  wirePart: WirePart
): HarnessWire[] {
  const target = wires.find((w) => w.id === wireId)
  if (!target) return wires
  const conductors = wirePart.conductors ?? 1
  if (conductors <= 1) {
    return wires.map((w) =>
      w.id === wireId ? { ...w, wirePartId: wirePart.id, color: wirePart.color ?? w.color } : w
    )
  }
  const pair = [target.from.end, target.to.end].sort().join('~')
  const takenLabels = new Set(
    wires
      .filter(
        (w) =>
          w.id !== wireId &&
          w.wirePartId === wirePart.id &&
          [w.from.end, w.to.end].sort().join('~') === pair
      )
      .map((w) => w.label)
  )
  const styles = conductorStyles(wirePart)
  const free = styles.find((s) => !s.label || !takenLabels.has(s.label)) ?? styles[0]
  return wires.map((w) =>
    w.id === wireId
      ? { ...w, wirePartId: wirePart.id, color: free.color ?? w.color, label: free.label ?? w.label }
      : w
  )
}

/**
 * Lay a multi-conductor cable between two endpoints. Conductors go to pins
 * with matching signal names first, then to the remaining free pins in order.
 * A shield, if the cable has one, lands on a ground pin where available.
 */
export function planCableDeploy(
  a: { label: string; endpoint: ResolvedEndpoint },
  b: { label: string; endpoint: ResolvedEndpoint },
  existing: HarnessWire[],
  wirePart: WirePart
): HarnessWire[] {
  const used = usedPins(existing)
  const freeA = a.endpoint.pins.filter(
    (p) => p.signalClass !== 'nc' && !used.has(pinKey(a.label, p.position))
  )
  const freeB = b.endpoint.pins.filter(
    (p) => p.signalClass !== 'nc' && !used.has(pinKey(b.label, p.position))
  )
  const take = (list: PinDef[], pin: PinDef) => list.splice(list.indexOf(pin), 1)[0]

  const strands: HarnessWire[] = []
  const make = (pa: PinDef, pb: PinDef, color?: string, label?: string): HarnessWire => ({
    id: nanoid(),
    from: { end: a.label, position: pa.position },
    to: { end: b.label, position: pb.position },
    wirePartId: wirePart.id,
    color,
    label
  })

  for (const style of conductorStyles(wirePart)) {
    let pair: [PinDef, PinDef] | null = null
    for (const pa of freeA) {
      const sa = norm(pa)
      const pb = sa ? freeB.find((x) => norm(x) === sa) : undefined
      if (pb) {
        pair = [pa, pb]
        break
      }
    }
    if (!pair && freeA.length > 0 && freeB.length > 0) pair = [freeA[0], freeB[0]]
    if (!pair) break
    strands.push(make(take(freeA, pair[0]), take(freeB, pair[1]), style.color, style.label))
  }

  if (wirePart.shield && freeA.length > 0 && freeB.length > 0) {
    const ga = freeA.find((p) => p.signalClass === 'ground') ?? freeA[0]
    const gb = freeB.find((p) => p.signalClass === 'ground') ?? freeB[0]
    strands.push(make(ga, gb, SHIELD_COLOR, 'SHIELD'))
  }
  return strands
}

/** "Splice 1", "Splice 2", … — the lowest number not already in use. */
export function nextSpliceName(splices: HarnessSplice[] | undefined): string {
  const taken = new Set((splices ?? []).map((s) => s.name))
  let n = 1
  while (taken.has(`Splice ${n}`)) n++
  return `Splice ${n}`
}
