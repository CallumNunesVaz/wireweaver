/**
 * Library mutations shared by the Library pane, the Library Manager and the
 * canvas, so every surface follows one policy:
 *
 *  - Deleting something that is in use is blocked (and says where it is used).
 *  - Deleting something unused asks first — the library has no undo.
 *  - All imports (packs, .wwlib, WireViz) merge through one path.
 */
import { nanoid } from 'nanoid'
import type { Part, PinoutTemplate } from '../model/types'
import { findPartReferences, findTemplateReferences } from '../model/references'
import { importWireViz } from '../model/wireviz-import'
import { parseLibraryFile, serializeLibraryFile } from '../model/project-file'
import { useLibraryStore, type MergeResult } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { getEffectiveLibrary } from '../stores/effectiveLibrary'
import { choiceDialog, confirmDialog } from '../shared/dialogs'
import { toast } from '../shared/toast'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function partReferences(id: string): string[] {
  const { parts, templates } = useLibraryStore.getState()
  return findPartReferences(id, parts, templates, useProjectStore.getState().project)
}

export function templateReferences(id: string): string[] {
  return findTemplateReferences(id, useLibraryStore.getState().parts)
}

function listRefs(refs: string[]): string {
  return refs.length > 6 ? `${refs.slice(0, 6).join(', ')} and ${refs.length - 6} more` : refs.join(', ')
}

/** Delete a library part. Resolves true when it was deleted. */
export async function deletePart(part: Part): Promise<boolean> {
  const refs = partReferences(part.id)
  if (refs.length > 0) {
    await choiceDialog({
      title: 'Part is in use',
      message: `"${part.name || 'This part'}" can't be deleted while it is in use.`,
      detail: `Used by: ${listRefs(refs)}.\nRemove those uses first.`,
      choices: [{ value: 'ok', label: 'OK', primary: true }]
    })
    return false
  }
  const ok = await confirmDialog({
    title: 'Delete part',
    message: `Delete "${part.name || 'this part'}" from the library?`,
    detail: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) useLibraryStore.getState().removePart(part.id)
  return ok
}

export async function deleteTemplate(t: PinoutTemplate): Promise<boolean> {
  const refs = templateReferences(t.id)
  if (refs.length > 0) {
    await choiceDialog({
      title: 'Template is in use',
      message: `"${t.name || 'This template'}" can't be deleted while ports use it.`,
      detail: `Used by: ${listRefs(refs)}.`,
      choices: [{ value: 'ok', label: 'OK', primary: true }]
    })
    return false
  }
  const ok = await confirmDialog({
    title: 'Delete pinout template',
    message: `Delete "${t.name || 'this template'}" from the library?`,
    detail: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) useLibraryStore.getState().removeTemplate(t.id)
  return ok
}

/**
 * Delete several items: in-use ones are skipped and reported. Resolves the ids
 * that were removed.
 */
export async function deleteMany(ids: string[]): Promise<string[]> {
  const { parts, templates, removePart, removeTemplate } = useLibraryStore.getState()
  const partById = new Map(parts.map((p) => [p.id, p]))
  const tplById = new Map(templates.map((t) => [t.id, t]))
  const deletable: { id: string; name: string; kind: 'part' | 'template' }[] = []
  const blocked: string[] = []
  for (const id of ids) {
    const p = partById.get(id)
    const t = tplById.get(id)
    if (p) {
      if (partReferences(id).length) blocked.push(p.name)
      else deletable.push({ id, name: p.name, kind: 'part' })
    } else if (t) {
      if (templateReferences(id).length) blocked.push(t.name)
      else deletable.push({ id, name: t.name, kind: 'template' })
    }
  }
  if (deletable.length === 0) {
    toast(`Nothing deleted: ${listRefs(blocked)} ${blocked.length === 1 ? 'is' : 'are'} in use.`, 'error')
    return []
  }
  const ok = await confirmDialog({
    title: 'Delete items',
    message: `Delete ${deletable.length} item${deletable.length === 1 ? '' : 's'} from the library?`,
    detail:
      listRefs(deletable.map((d) => d.name || '(unnamed)')) +
      (blocked.length ? `\n\nSkipped because in use: ${listRefs(blocked)}` : '') +
      '\n\nThis cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return []
  for (const d of deletable) {
    if (d.kind === 'part') removePart(d.id)
    else removeTemplate(d.id)
  }
  return deletable.map((d) => d.id)
}

export function duplicatePart(part: Part): Part {
  const now = Date.now()
  const copy = { ...structuredClone(part), id: nanoid(), name: `${part.name} copy`, createdAt: now, updatedAt: now }
  useLibraryStore.getState().upsertPart(copy)
  return copy
}

function reportMerge(source: string, r: MergeResult): void {
  if (r.addedParts === 0 && r.addedTemplates === 0) {
    toast(`${source}: nothing new to add (everything is already in your library).`, 'info')
  } else {
    toast(`${source}: added ${r.addedParts} part(s) and ${r.addedTemplates} template(s).`, 'success')
  }
}

export async function importLibraryFile(): Promise<void> {
  try {
    const res = await window.ww.library.import()
    if (res.canceled) return
    if (res.error) throw new Error(res.error)
    reportMerge('Library import', useLibraryStore.getState().mergeItems(parseLibraryFile(res.data)))
  } catch (err) {
    toast(`Library import failed: ${errMessage(err)}`, 'error')
  }
}

export async function exportLibraryFile(): Promise<void> {
  try {
    const { parts, templates } = useLibraryStore.getState()
    const res = await window.ww.library.export(serializeLibraryFile(parts, templates))
    if (!res.canceled && res.path) toast(`Library exported to ${res.path}`, 'success')
  } catch (err) {
    toast(`Library export failed: ${errMessage(err)}`, 'error')
  }
}

export async function importWireVizFile(): Promise<void> {
  try {
    const res = await window.ww.file.readText({ filterName: 'WireViz YAML', extensions: ['yml', 'yaml'] })
    if (res.canceled || !res.content) return
    const imported = importWireViz(res.content, getEffectiveLibrary().lib)
    reportMerge('WireViz import', useLibraryStore.getState().mergeItems(imported))
  } catch (err) {
    toast(`WireViz import failed: ${errMessage(err)}`, 'error')
  }
}

export async function installPack(packId: string): Promise<void> {
  try {
    const res = await window.ww.library.readPack(packId)
    if (!res.data) throw new Error('the pack file could not be read')
    reportMerge('Pack installed', useLibraryStore.getState().mergeItems(parseLibraryFile(res.data)))
  } catch (err) {
    toast(`Pack install failed: ${errMessage(err)}`, 'error')
  }
}
