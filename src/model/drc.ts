/**
 * Design rule check: project-wide integrity rules beyond per-harness
 * validation. Issues carry an optional target so the UI can jump to it.
 */
import type { Project } from './types'
import { endLabel, isDevice } from './types'
import type { LibraryLike } from './derivation'
import { resolveAllEndpoints, validateHarness } from './derivation'

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
      const isError = v.status === 'invalid' && /unresolved|reference pins/i.test(w)
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
    for (const w of h.wires) {
      if (!w.twistedWith) continue
      const mate = byId.get(w.twistedWith)
      if (!mate || mate.twistedWith !== w.id) {
        warn(`Harness "${h.name}": twisted-pair reference on a wire is not mutual.`, t)
      }
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
      const covered = (a: string, b: string) =>
        h.segments.some(
          (s) =>
            s.lengthMm != null &&
            ((s.fromEnd === a && s.toEnd === b) || (s.fromEnd === b && s.toEnd === a))
        )
      const missing = [...wiredPairs]
        .map((k) => k.split('~') as [string, string])
        .filter(([a, b]) => !covered(a, b))
      if (missing.length > 0) {
        warn(
          `Harness "${h.name}": segment length missing for ${missing
            .map(([a, b]) => `${a}–${b}`)
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
  }

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return issues
}
