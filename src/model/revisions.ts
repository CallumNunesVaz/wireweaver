import { nanoid } from 'nanoid'
import type { Project, ProjectRevision } from './types'

export function createRevision(
  project: Project,
  label: string,
  description?: string
): ProjectRevision {
  const { revisions, ...rest } = project
  return {
    id: nanoid(),
    timestamp: Date.now(),
    label,
    description,
    project: structuredClone(rest)
  }
}

export function diffRevisions(a: Project, b: Project): string[] {
  const lines: string[] = []

  const aDeviceIds = new Set(a.deviceInstances.map((d) => d.id))
  const bDeviceIds = new Set(b.deviceInstances.map((d) => d.id))
  for (const d of b.deviceInstances) {
    if (!aDeviceIds.has(d.id)) {
      lines.push(`Added device '${d.label}'`)
    }
  }
  for (const d of a.deviceInstances) {
    if (!bDeviceIds.has(d.id)) {
      lines.push(`Removed device '${d.label}'`)
    }
  }

  const aHarnessIds = new Set(a.harnesses.map((h) => h.id))
  const bHarnessIds = new Set(b.harnesses.map((h) => h.id))
  const aHarnessesById = new Map(a.harnesses.map((h) => [h.id, h]))
  for (const h of b.harnesses) {
    if (!aHarnessIds.has(h.id)) {
      lines.push(`Added harness '${h.name}'`)
      continue
    }
    const aH = aHarnessesById.get(h.id)
    if (aH && aH.wires.length !== h.wires.length) {
      lines.push(`Changed wire count in harness '${h.name}'`)
    }
  }
  for (const h of a.harnesses) {
    if (!bHarnessIds.has(h.id)) {
      lines.push(`Removed harness '${h.name}'`)
    }
  }

  return lines
}

export function restoreRevision(
  project: Project,
  revisionId: string
): Project {
  const rev = project.revisions.find((r) => r.id === revisionId)
  if (!rev) return project
  return {
    ...rev.project,
    id: project.id,
    revisions: project.revisions
  }
}
