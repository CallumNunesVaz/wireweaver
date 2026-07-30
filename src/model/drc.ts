/**
 * Design rule check: project-wide integrity rules beyond per-harness
 * validation. Issues carry an optional target so the UI can jump to it.
 */
import type { Project } from './types'
import { endLabel, isDevice, isWire } from './types'
import type { LibraryLike } from './derivation'
import { resolveAllEndpoints, validateHarness, validateSplices } from './derivation'

export type DrcSeverity = 'error' | 'warning'

export interface DrcIssue {
  severity: DrcSeverity
  message: string
  target?: { type: 'instance' | 'harness'; id: string }
}

export function runDrc(lib: LibraryLike, project: Project): DrcIssue[] {
  const issues: DrcIssue[] = []
  const err = (message: string, target?: DrcIssue['target']) =>
    issues.push({ severity: 'error', message, target })
  const warn = (message: string, target?: DrcIssue['target']) =>
    issues.push({ severity: 'warning', message, target })

    // Device instances referencing missing parts or templates.
  for (const inst of project.deviceInstances) {
    const part = lib.parts[inst.partId]
    const t = { type: 'instance' as const, id: inst.id }
    if (!part || !isDevice(part)) {
      err(`Device "${inst.label}" references a missing library part.`, t)
      continue
    }
    // Placeholder part check (Feature 2)
    if (part.isPlaceholder) {
      warn(
        `Device "${inst.label}" uses placeholder part "${part.name}" — replace before manufacturing.`,
        t
      )
    }
    for (const port of part.ports) {
      if (!lib.templates[port.pinoutTemplateId]) {
        warn(
          `Device "${inst.label}" port "${port.name}" has no pinout template.`,
          t
        )
      }
    }
  }

  // One port belongs to at most one harness.
  const portOwners = new Map<string, string>()
  for (const h of project.harnesses) {
    for (const ep of h.endpoints) {
      const key = `${ep.deviceInstanceId}:${ep.portId}`
      const owner = portOwners.get(key)
      if (owner && owner !== h.id) {
        const inst = project.deviceInstances.find((i) => i.id === ep.deviceInstanceId)
        err(
          `Port on "${inst?.label ?? ep.deviceInstanceId}" belongs to more than one harness.`,
          { type: 'harness', id: h.id }
        )
      } else {
        portOwners.set(key, h.id)
      }
    }
  }

  for (const h of project.harnesses) {
    const t = { type: 'harness' as const, id: h.id }
    const v = validateHarness(lib, project.deviceInstances, h)

    // Per-harness validation results (unresolved endpoints, orphan wires,
    // signal-class mismatches) surface as DRC issues too.
    for (const w of v.warnings) {
      const isError = v.status === 'invalid' && /^unresolved endpoint| reference pins that no longer exist/i.test(w)
      ;(isError ? err : warn)(`Harness "${h.name}": ${w}`, t)
    }

    const { resolved } = resolveAllEndpoints(lib, project.deviceInstances, h)

    // Wires without an assigned wire part can't be cut or bought.
    const unassigned = h.wires.filter((w) => !w.wirePartId).length
    if (unassigned > 0) {
      warn(`Harness "${h.name}": ${unassigned} wire(s) have no wire part assigned.`, t)
    }

    // Twisted-pair references must be mutual.
    const byId = new Map(h.wires.map((w) => [w.id, w]))
    const warnedTwists = new Set<string>()
    for (const w of h.wires) {
      if (!w.twistedWith || warnedTwists.has(w.id)) continue
      const mate = byId.get(w.twistedWith)
      if (!mate || mate.twistedWith !== w.id) {
        warn(`Harness "${h.name}": twisted-pair reference on a wire is not mutual.`, t)
      }
      warnedTwists.add(w.id)
      warnedTwists.add(w.twistedWith)
    }

    // Every wired endpoint pair needs a segment length or the cutlist and
    // wiring table are incomplete — checking existing segments isn't enough,
    // star-wired pairs (e.g. a–c) may have no segment at all.
    if (h.wires.length > 0) {
      const wiredPairs = new Set<string>()
      for (const w of h.wires) {
        if (w.from.end !== w.to.end) {
          wiredPairs.add([w.from.end, w.to.end].sort().join('~'))
        }
      }
      const coveredPairs = new Set(
        (h.segments ?? []).filter((s) => s.lengthMm != null).map((s) => [s.fromEnd, s.toEnd].sort().join('~'))
      )
      const missing = [...wiredPairs].filter((k) => !coveredPairs.has(k))
      if (missing.length > 0) {
        warn(
          `Harness "${h.name}": segment length missing for ${missing
            .map((k) => k.replace('~', '–'))
            .join(', ')} — cutlist will be incomplete.`,
          t
        )
      }
    }

    // Unterminated pins: only meaningful once wiring has started.
    if (h.wires.length > 0) {
      const used = new Set<string>()
      for (const w of h.wires) {
        used.add(`${w.from.end}:${w.from.position}`)
        used.add(`${w.to.end}:${w.to.position}`)
      }
      for (let i = 0; i < h.endpoints.length; i++) {
        const label = endLabel(i)
        const re = resolved.get(label)
        if (!re) continue
        const unwired = re.pins.filter(
          (p) => p.signalClass !== 'nc' && !used.has(`${label}:${p.position}`)
        )
        if (unwired.length > 0) {
          warn(
            `Harness "${h.name}": ${unwired.length} pin(s) unterminated on ` +
              `${re.instance.label} ${re.port.name} (${unwired
                .slice(0, 6)
                .map((p) => p.position)
                .join(', ')}${unwired.length > 6 ? ', …' : ''}).`,
            t
          )
        }
      }
    }

    // Placeholder wire part check (Feature 2)
    for (const w of h.wires) {
      if (!w.wirePartId) continue
      const wirePart = lib.parts[w.wirePartId]
      if (wirePart?.isPlaceholder) {
        warn(
          `Harness "${h.name}": wire uses placeholder part "${wirePart.name}" — replace before manufacturing.`,
          t
        )
      }
    }

    // Placeholder connector part check (Feature 2)
    for (const [, re] of resolved) {
      if (re.connector?.isPlaceholder) {
        warn(
          `Harness "${h.name}": connector "${re.connector.name}" at "${re.instance.label} ${re.port.name}" is a placeholder — replace before manufacturing.`,
          t
        )
      }
    }

    // Current rating on connectors DRC (Feature 3)
    for (let i = 0; i < h.endpoints.length; i++) {
      const label = endLabel(i)
      const re = resolved.get(label)
      if (!re?.connector?.currentRatingAmps || !re.template) continue
      const maxPinCurrent = Math.max(
        ...re.template.pins.map((p) => p.maxCurrentAmps ?? 0),
        0
      )
      if (maxPinCurrent > re.connector.currentRatingAmps) {
        err(
          `Harness "${h.name}": pin current (${maxPinCurrent}A) exceeds connector "${re.connector.name}" rating (${re.connector.currentRatingAmps}A) at ${re.instance.label} ${re.port.name}.`,
          t
        )
      }
    }

    // Shield continuity DRC (Feature 4)
    const shieldWires = h.wires.filter((w) => {
      if (!w.wirePartId) return false
      const part = lib.parts[w.wirePartId]
      return part && isWire(part) && part.shield === true
    })
    for (const sw of shieldWires) {
      const fromPin = resolved
        .get(sw.from.end)
        ?.pins.find((p) => p.position === sw.from.position)
      const toPin = resolved
        .get(sw.to.end)
        ?.pins.find((p) => p.position === sw.to.position)
      const hasGround =
        fromPin?.signalClass === 'ground' || toPin?.signalClass === 'ground'
      if (!hasGround) {
        warn(
          `Shield wire on harness "${h.name}" is not connected to a ground pin.`,
          t
        )
      }
    }

    // Splice validation (Feature 6)
    const spliceWarnings = validateSplices(h)
    for (const sw of spliceWarnings) {
      warn(`Harness "${h.name}": ${sw}`, t)
    }
  }

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return issues
}
