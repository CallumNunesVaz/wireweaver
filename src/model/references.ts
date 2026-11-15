import type { Part, PinoutTemplate, Project } from './types'
import { isDevice } from './types'

/**
 * Everything in the library that still points at this part. A part with
 * references must not be deleted or IDs would dangle.
 */
export function findPartReferences(
  partId: string,
  parts: Part[],
  templates: PinoutTemplate[],
  project: Project
): string[] {
  const refs: string[] = []
  const part = parts.find((p) => p.id === partId)
  if (!part) return refs

  type Usage = Pick<Project, 'deviceInstances' | 'harnesses'>
  /** Uses of this part inside one project state (current or a revision). */
  const usesIn = (p: Usage): string[] => {
    const out: string[] = []
    if (part.kind === 'device') {
      const n = p.deviceInstances.filter((i) => i.partId === partId).length
      if (n > 0) out.push(`${n} placed instance${n === 1 ? '' : 's'}`)
    }
    let wires = 0
    let splices = 0
    let accessories = 0
    for (const h of p.harnesses) {
      for (const w of h.wires) if (w.wirePartId === partId) wires++
      for (const sp of h.splices ?? []) if (sp.wirePartId === partId) splices++
      for (const a of h.accessories ?? []) if (a.partId === partId) accessories++
    }
    if (wires > 0) out.push(`${wires} harness wire${wires === 1 ? '' : 's'}`)
    if (splices > 0) out.push(`${splices} splice${splices === 1 ? '' : 's'}`)
    if (accessories > 0) out.push(`${accessories} harness accessor${accessories === 1 ? 'y' : 'ies'}`)
    return out
  }

  if (part.kind === 'connector') {
    for (const t of templates) {
      if (t.connectorPartId === partId) refs.push(`pinout template “${t.name}”`)
    }
  }
  refs.push(...usesIn(project))
  // Revisions no longer embed their own snapshots — the project's top-level
  // snapshots cover them, filled from the library on save. A part used only
  // by a revision must therefore stay in the library, or restoring that
  // revision would show it as missing.
  for (const rev of project.revisions ?? []) {
    if (usesIn(rev.project).length > 0) refs.push(`revision “${rev.label}”`)
  }
  return refs
}

/** Device ports that use this pinout template. */
export function findTemplateReferences(templateId: string, parts: Part[]): string[] {
  const refs: string[] = []
  for (const p of parts) {
    if (!isDevice(p)) continue
    for (const port of p.ports) {
      if (port.pinoutTemplateId === templateId) refs.push(`${p.name} · ${port.name}`)
    }
  }
  return refs
}
