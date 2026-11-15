import type { Part, PinoutTemplate, Project } from './types'

/**
 * Return a copy of the project with partSnapshots/templateSnapshots filled from
 * the library, covering everything the project references (devices, their port
 * templates, those templates' connectors, and assigned wire parts). Revisions
 * no longer carry their own snapshots, so the top-level maps also cover every
 * part/template referenced by any revision — restoring an old revision still
 * resolves. Written on every save so a .wwv opens on a machine with a
 * different library.
 */
export function withSnapshots(
  project: Project,
  parts: Part[],
  templates: PinoutTemplate[]
): Project {
  const partById = new Map(parts.map((p) => [p.id, p]))
  const tplById = new Map(templates.map((t) => [t.id, t]))
  const partSnapshots: Record<string, Part> = {}
  const templateSnapshots: Record<string, PinoutTemplate> = {}

  const addPart = (id?: string): void => {
    if (!id || partSnapshots[id]) return
    const p = partById.get(id)
    if (!p) return
    partSnapshots[id] = p
    if (p.kind === 'device') {
      for (const port of p.ports) addTemplate(port.pinoutTemplateId)
    }
  }
  const addTemplate = (id?: string): void => {
    if (!id || templateSnapshots[id]) return
    const t = tplById.get(id)
    if (!t) return
    templateSnapshots[id] = t
    addPart(t.connectorPartId)
  }

  const collect = (p: Pick<Project, 'deviceInstances' | 'harnesses'>): void => {
    for (const inst of p.deviceInstances) addPart(inst.partId)
    for (const h of p.harnesses) {
      for (const w of h.wires) addPart(w.wirePartId)
      for (const a of h.accessories ?? []) addPart(a.partId)
      for (const s of h.splices ?? []) addPart(s.wirePartId)
    }
  }

  collect(project)
  for (const rev of project.revisions ?? []) collect(rev.project)

  return { ...project, partSnapshots, templateSnapshots }
}

/**
 * Snapshot entries an opened project carries that the local library is missing
 * — these get merged into the library so the project renders fully.
 */
export function missingFromLibrary(
  project: Project,
  parts: Part[],
  templates: PinoutTemplate[]
): { parts: Part[]; templates: PinoutTemplate[] } {
  const partIds = new Set(parts.map((p) => p.id))
  const tplIds = new Set(templates.map((t) => t.id))
  return {
    parts: Object.values(project.partSnapshots ?? {}).filter((p) => !partIds.has(p.id)),
    templates: Object.values(project.templateSnapshots ?? {}).filter(
      (t) => !tplIds.has(t.id)
    )
  }
}
