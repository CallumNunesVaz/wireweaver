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

  if (part.kind === 'device') {
    const n = project.deviceInstances.filter((i) => i.partId === partId).length
    if (n > 0) refs.push(`${n} placed instance${n === 1 ? '' : 's'}`)
  }
  if (part.kind === 'connector') {
    for (const t of templates) {
      if (t.connectorPartId === partId) refs.push(`pinout template “${t.name}”`)
    }
  }
  if (part.kind === 'wire') {
    let n = 0
    for (const h of project.harnesses) {
      for (const w of h.wires) if (w.wirePartId === partId) n++
    }
    if (n > 0) refs.push(`${n} harness wire${n === 1 ? '' : 's'}`)
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
