/**
 * Manufacturing documentation derived from a project: wiring tables (from–to
 * lists), cutlists and netlists, plus CSV serializers for each.
 */
import type { Harness, HarnessWire, Project } from './types'
import { isWire } from './types'
import type { LibraryLike, ResolvedEndpoint } from './derivation'
import { resolveAllEndpoints } from './derivation'
import { formatGauge } from './wire'

// ---------- Wiring table ----------

export interface WiringRow {
  harness: string
  wire: string
  fromDevice: string
  fromPort: string
  fromPin: number
  fromSignal: string
  toDevice: string
  toPort: string
  toPin: number
  toSignal: string
  color: string
  gauge: string
  wirePart: string
  lengthMm?: number
  twistedWith: string
}

/** Display labels for a harness's wires: user label, else W1, W2, … in order. */
export function wireLabels(harness: Harness): Map<string, string> {
  const labels = new Map<string, string>()
  harness.wires.forEach((w, i) => labels.set(w.id, w.label || `W${i + 1}`))
  return labels
}

function buildSegmentMap(harness: Harness): Map<string, number | undefined> {
  const map = new Map<string, number | undefined>()
  for (const s of harness.segments ?? []) {
    map.set([s.fromEnd, s.toEnd].sort().join('~'), s.lengthMm)
  }
  return map
}

function segmentLengthMm(w: HarnessWire, segMap: Map<string, number | undefined>): number | undefined {
  return segMap.get([w.from.end, w.to.end].sort().join('~'))
}

function signalAt(re: ResolvedEndpoint | undefined, position: number): string {
  return re?.pins.find((p) => p.position === position)?.signal ?? ''
}

export function wiringTable(
  lib: LibraryLike,
  project: Project,
  harness: Harness
): WiringRow[] {
  const { resolved } = resolveAllEndpoints(lib, project.deviceInstances, harness)
  const labels = wireLabels(harness)
  const segMap = buildSegmentMap(harness)
  const rows: WiringRow[] = []
  for (const w of harness.wires) {
    const from = resolved.get(w.from.end)
    const to = resolved.get(w.to.end)
    const part = w.wirePartId ? lib.parts[w.wirePartId] : undefined
    const wirePart = part && isWire(part) ? part : undefined
    rows.push({
      harness: harness.name,
      wire: labels.get(w.id) ?? w.id,
      fromDevice: from?.instance.label ?? `(${w.from.end})`,
      fromPort: from?.port.name ?? '',
      fromPin: w.from.position,
      fromSignal: signalAt(from, w.from.position),
      toDevice: to?.instance.label ?? `(${w.to.end})`,
      toPort: to?.port.name ?? '',
      toPin: w.to.position,
      toSignal: signalAt(to, w.to.position),
      color: w.color ?? wirePart?.color ?? '',
      gauge: formatGauge(wirePart?.gauge),
      wirePart: wirePart?.name ?? '',
      lengthMm: segmentLengthMm(w, segMap),
      twistedWith: w.twistedWith ? labels.get(w.twistedWith) ?? '' : ''
    })
  }
  return rows
}

export function wiringTableAll(lib: LibraryLike, project: Project): WiringRow[] {
  return project.harnesses.flatMap((h) => wiringTable(lib, project, h))
}

// ---------- Cutlist ----------

export interface CutlistRow {
  wirePart: string
  gauge: string
  color: string
  /** Cut length including slack; undefined when no segment length is set. */
  cutLengthMm?: number
  quantity: number
}

/**
 * Aggregate every wire strand in the project into cut instructions, grouped by
 * wire part × gauge × color × cut length. slackMm is added to each cut for
 * termination/service loop allowance.
 */
export function cutlist(lib: LibraryLike, project: Project, slackMm = 0): CutlistRow[] {
  const groups = new Map<string, CutlistRow>()
  for (const h of project.harnesses) {
    const segMap = buildSegmentMap(h)
    for (const w of h.wires) {
      const part = w.wirePartId ? lib.parts[w.wirePartId] : undefined
      const wirePart = part && isWire(part) ? part : undefined
      const length = segmentLengthMm(w, segMap)
      const cut = length != null ? length + slackMm : undefined
      const row: CutlistRow = {
        wirePart: wirePart?.name ?? '(unspecified)',
        gauge: formatGauge(wirePart?.gauge),
        color: w.color ?? wirePart?.color ?? '',
        cutLengthMm: cut,
        quantity: 1
      }
      const key = [row.wirePart, row.gauge, row.color, row.cutLengthMm ?? '?'].join('|')
      const existing = groups.get(key)
      if (existing) existing.quantity += 1
      else groups.set(key, row)
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.wirePart.localeCompare(b.wirePart) ||
      a.color.localeCompare(b.color) ||
      (a.cutLengthMm ?? 0) - (b.cutLengthMm ?? 0)
  )
}

// ---------- Netlist ----------

export interface NetNode {
  device: string
  port: string
  pin: number
  signal: string
}

export interface Net {
  name: string
  nodes: NetNode[]
}

/**
 * Electrical nets across the whole project: pins joined by any harness wire
 * form one net (connected component). Net names come from the most common
 * non-empty signal name among member pins, falling back to NET1, NET2, …
 */
export function netlist(lib: LibraryLike, project: Project): Net[] {
  // Union-find over pin keys `${instanceId}:${portId}:${position}`.
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    while (parent.get(root) !== root) root = parent.get(root)!
    // Path compression.
    let cur = k
    while (cur !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k)
  }
  const union = (a: string, b: string) => {
    add(a)
    add(b)
    parent.set(find(a), find(b))
  }

  const nodes = new Map<string, NetNode>()
  for (const h of project.harnesses) {
    const { resolved } = resolveAllEndpoints(lib, project.deviceInstances, h)
    const keyOf = (end: string, position: number): string | undefined => {
      const re = resolved.get(end)
      if (!re) return undefined
      const key = `${re.instance.id}:${re.port.id}:${position}`
      if (!nodes.has(key)) {
        nodes.set(key, {
          device: re.instance.label,
          port: re.port.name,
          pin: position,
          signal: signalAt(re, position)
        })
      }
      return key
    }
    for (const w of h.wires) {
      const a = keyOf(w.from.end, w.from.position)
      const b = keyOf(w.to.end, w.to.position)
      if (a && b) union(a, b)
    }
  }

  const byRoot = new Map<string, NetNode[]>()
  for (const key of nodes.keys()) {
    const root = find(key)
    const list = byRoot.get(root) ?? []
    list.push(nodes.get(key)!)
    byRoot.set(root, list)
  }

  const nets: Net[] = []
  let anon = 0
  for (const members of byRoot.values()) {
    members.sort(
      (a, b) =>
        a.device.localeCompare(b.device) ||
        a.port.localeCompare(b.port) ||
        a.pin - b.pin
    )
    const counts = new Map<string, number>()
    for (const n of members) {
      if (n.signal) counts.set(n.signal, (counts.get(n.signal) ?? 0) + 1)
    }
    let name = ''
    let best = 0
    for (const [signal, count] of counts) {
      if (count > best) {
        name = signal
        best = count
      }
    }
    nets.push({ name: name || `NET${++anon}`, nodes: members })
  }
  nets.sort((a, b) => a.name.localeCompare(b.name))
  return nets
}

// ---------- CSV ----------

function esc(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function wiringCsv(rows: WiringRow[]): string {
  const header = [
    'Harness',
    'Wire',
    'From Device',
    'From Port',
    'From Pin',
    'From Signal',
    'To Device',
    'To Port',
    'To Pin',
    'To Signal',
    'Color',
    'Gauge',
    'Wire Part',
    'Length (mm)',
    'Twisted With'
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.harness,
        r.wire,
        r.fromDevice,
        r.fromPort,
        r.fromPin,
        r.fromSignal,
        r.toDevice,
        r.toPort,
        r.toPin,
        r.toSignal,
        r.color,
        r.gauge,
        r.wirePart,
        r.lengthMm ?? '',
        r.twistedWith
      ]
        .map(esc)
        .join(',')
    )
  }
  return lines.join('\n')
}

export function cutlistCsv(rows: CutlistRow[]): string {
  const lines = ['Wire Part,Gauge,Color,Cut Length (mm),Quantity']
  for (const r of rows) {
    lines.push(
      [r.wirePart, r.gauge, r.color, r.cutLengthMm ?? 'unknown', r.quantity]
        .map(esc)
        .join(',')
    )
  }
  return lines.join('\n')
}

export function netlistCsv(nets: Net[]): string {
  const lines = ['Net,Device,Port,Pin,Signal']
  for (const net of nets) {
    for (const n of net.nodes) {
      lines.push([net.name, n.device, n.port, n.pin, n.signal].map(esc).join(','))
    }
  }
  return lines.join('\n')
}

// ---------- Bundle / segment labels ----------

export interface BundleLabel {
  label: string
  fromEnd: string
  toEnd: string
  lengthMm?: number
}

/**
 * Generate unique labels for each harness segment. Labels follow the pattern
 * "A-B-1", "A-B-2", etc. based on the endpoint pair.
 */
export function bundleLabels(harness: Harness): BundleLabel[] {
  const pairCounts = new Map<string, number>()
  const results: BundleLabel[] = []

  for (const seg of harness.segments) {
    const key = [seg.fromEnd, seg.toEnd].sort().join('-').toUpperCase()
    const count = (pairCounts.get(key) ?? 0) + 1
    pairCounts.set(key, count)
    results.push({
      label: `${key}-${count}`,
      fromEnd: seg.fromEnd,
      toEnd: seg.toEnd,
      lengthMm: seg.lengthMm
    })
  }

  return results
}

/** Export bundle labels as CSV compatible with Brady/Dymo label printers. */
export function bundleLabelsCsv(
  rows: { label: string; fromEnd: string; toEnd: string; lengthMm?: number }[]
): string {
  const lines = ['Label,From,To,Length']
  for (const r of rows) {
    lines.push(
      [r.label, r.fromEnd, r.toEnd, r.lengthMm ?? ''].map(esc).join(',')
    )
  }
  return lines.join('\n')
}
