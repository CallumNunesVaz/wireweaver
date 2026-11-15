/**
 * The library a project is rendered and checked against: the user's library,
 * with the project's embedded part/template snapshots filling in anything the
 * library lacks. A project from another machine (or written by the MCP
 * server) therefore renders, validates and reports fully without first
 * importing its parts. Library entries win when both exist, so editing a
 * part in the library still updates the projects that use it.
 */
import { useMemo } from 'react'
import type { Part, PinoutTemplate, Project, WirePart } from '../model/types'
import { isWire } from '../model/types'
import type { LibraryLike } from '../model/derivation'
import type { DrcIssue } from '../model/drc'
import { useDrc } from './drcScheduler'
import { useLibraryStore } from './libraryStore'
import { useProjectStore } from './projectStore'

export interface EffectiveLibrary {
  lib: LibraryLike
  parts: Part[]
  templates: PinoutTemplate[]
  wireParts: WirePart[]
  /** Ids that resolve only through the project's snapshots. */
  snapshotOnly: Set<string>
}

type Snapshots = Pick<Project, 'partSnapshots' | 'templateSnapshots'>

let cache: {
  parts: Part[]
  templates: PinoutTemplate[]
  partSnapshots: Project['partSnapshots']
  templateSnapshots: Project['templateSnapshots']
  value: EffectiveLibrary
} | null = null

export function buildEffectiveLibrary(
  parts: Part[],
  templates: PinoutTemplate[],
  snapshots: Snapshots
): EffectiveLibrary {
  const ps = snapshots.partSnapshots ?? {}
  const ts = snapshots.templateSnapshots ?? {}
  if (
    cache &&
    cache.parts === parts &&
    cache.templates === templates &&
    cache.partSnapshots === ps &&
    cache.templateSnapshots === ts
  ) {
    return cache.value
  }
  const partMap: Record<string, Part> = {}
  const tplMap: Record<string, PinoutTemplate> = {}
  const snapshotOnly = new Set<string>()
  for (const p of parts) partMap[p.id] = p
  for (const t of templates) tplMap[t.id] = t
  const allParts = parts.slice()
  const allTemplates = templates.slice()
  for (const p of Object.values(ps)) {
    if (p && !partMap[p.id]) {
      partMap[p.id] = p
      allParts.push(p)
      snapshotOnly.add(p.id)
    }
  }
  for (const t of Object.values(ts)) {
    if (t && !tplMap[t.id]) {
      tplMap[t.id] = t
      allTemplates.push(t)
      snapshotOnly.add(t.id)
    }
  }
  const value: EffectiveLibrary = {
    lib: { parts: partMap, templates: tplMap },
    parts: allParts,
    templates: allTemplates,
    wireParts: allParts.filter(isWire),
    snapshotOnly
  }
  cache = { parts, templates, partSnapshots: ps, templateSnapshots: ts, value }
  return value
}

/** Non-hook read for event handlers. */
export function getEffectiveLibrary(): EffectiveLibrary {
  const { parts, templates } = useLibraryStore.getState()
  return buildEffectiveLibrary(parts, templates, useProjectStore.getState().project)
}

export function useEffectiveLibrary(): EffectiveLibrary {
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const partSnapshots = useProjectStore((s) => s.project.partSnapshots)
  const templateSnapshots = useProjectStore((s) => s.project.templateSnapshots)
  return useMemo(
    () => buildEffectiveLibrary(parts, templates, { partSnapshots, templateSnapshots }),
    [parts, templates, partSnapshots, templateSnapshots]
  )
}

/**
 * Design-rule check, computed once per (library, project) change and shared
 * by every subscriber (header badge, DRC panel). Small projects are checked
 * synchronously; large projects are checked off the main thread and return the
 * last good result while the worker catches up (see `src/stores/drcScheduler.ts`).
 */
export function useDrcIssues(): DrcIssue[] {
  const { lib } = useEffectiveLibrary()
  const project = useProjectStore((s) => s.project)
  return useDrc(lib, project)
}
