/**
 * Project file actions (new / open / save / export). Plain async functions
 * over the stores, so the title bar, command palette, keyboard shortcuts and
 * native menu all call exactly the same code.
 */
import { create } from 'zustand'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useLibraryStore } from '../stores/libraryStore'
import { getEffectiveLibrary } from '../stores/effectiveLibrary'
import { withSnapshots, missingFromLibrary } from '../model/snapshot'
import { serializeProjectFile } from '../model/project-file'
import { exportBomCsv } from '../model/bom'
import type { RecentEntry } from '../ipc/contract'
import { toast } from '../shared/toast'
import { choiceDialog, confirmDialog, promptDialog } from '../shared/dialogs'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const useRecentStore = create<{ recent: RecentEntry[] }>(() => ({ recent: [] }))

export async function refreshRecent(): Promise<void> {
  try {
    useRecentStore.setState({ recent: await window.ww.recent.get() })
  } catch {
    /* recents are a convenience */
  }
}

function rememberRecent(name: string, path: string): void {
  window.ww.recent
    .add({ name, path })
    .then((recent) => useRecentStore.setState({ recent }))
    .catch(() => {})
}

/** The project as written to disk: snapshots embedded, schema stamped. */
export function projectForDisk() {
  const { project } = useProjectStore.getState()
  const eff = getEffectiveLibrary()
  return serializeProjectFile(withSnapshots(project, eff.parts, eff.templates))
}

/**
 * Ask what to do with unsaved changes. Resolves true when it is OK to replace
 * the current project (saved, or the user chose to discard).
 */
export async function confirmDiscard(action = 'continue'): Promise<boolean> {
  if (!useProjectStore.getState().dirty) return true
  const choice = await choiceDialog({
    title: 'Unsaved changes',
    message: `Save changes to "${useProjectStore.getState().project.name}" before you ${action}?`,
    detail: "If you don't save, your changes will be lost.",
    choices: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'discard', label: "Don't save", danger: true },
      { value: 'save', label: 'Save', primary: true }
    ]
  })
  if (choice === 'save') return saveProject()
  return choice === 'discard'
}

/** Save to the current file (or ask where). Resolves true when saved. */
export async function saveProject(forceDialog = false): Promise<boolean> {
  try {
    const { filePath, project } = useProjectStore.getState()
    const res = await window.ww.project.save(forceDialog ? undefined : filePath, projectForDisk())
    if (res.canceled || !res.path) return false
    useProjectStore.getState().markSaved(res.path)
    window.ww.project.clearRecovery().catch(() => {})
    rememberRecent(project.name, res.path)
    toast(`Saved to ${res.path}`, 'success')
    return true
  } catch (err) {
    toast(`Save failed: ${errMessage(err)}`, 'error')
    return false
  }
}

/** Replace the current project with parsed file data. */
export function applyOpened(data: unknown, path: string | undefined, opts: { recovered?: boolean } = {}): boolean {
  try {
    useProjectStore.getState().loadProject(data, path)
  } catch (err) {
    toast(`Could not open ${path ?? 'project'}: ${errMessage(err)}`, 'error')
    return false
  }
  useProjectStore.temporal.getState().clear()
  useUiStore.getState().select(null)
  useUiStore.getState().closeHarnessEditor()
  if (opts.recovered) {
    useProjectStore.getState().markDirty()
  } else {
    window.ww.project.clearRecovery().catch(() => {})
  }
  const project = useProjectStore.getState().project
  // Parts the project carries but the library lacks render from the
  // project's snapshots; offer (don't force) adding them to the library.
  const lib = useLibraryStore.getState()
  const missing = missingFromLibrary(project, lib.parts, lib.templates)
  if (missing.parts.length > 0 || missing.templates.length > 0) {
    useUiStore.getState().setReconciliation(missing)
  }
  if (path && !opts.recovered) rememberRecent(project.name, path)
  useUiStore.getState().requestFitView()
  return true
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscard('open another project'))) return
  try {
    const res = await window.ww.project.open()
    if (res.canceled || !res.path) return
    if (res.error) toast(`Could not open ${res.path}: ${res.error}`, 'error')
    else applyOpened(res.data, res.path)
  } catch (err) {
    toast(`Open failed: ${errMessage(err)}`, 'error')
  }
}

export async function openProjectPath(path: string, ask = true): Promise<void> {
  if (ask && !(await confirmDiscard('open another project'))) return
  try {
    const res = await window.ww.project.openPath(path)
    if (res.error || !res.path) toast(`Could not open ${path}: ${res.error ?? 'unknown error'}`, 'error')
    else applyOpened(res.data, res.path)
  } catch (err) {
    toast(`Could not open ${path}: ${errMessage(err)}`, 'error')
  }
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard('start a new project'))) return
  useUiStore.getState().select(null)
  useUiStore.getState().closeHarnessEditor()
  useProjectStore.getState().newProject()
  useProjectStore.temporal.getState().clear()
  window.ww.project.clearRecovery().catch(() => {})
}

export async function renameProject(): Promise<void> {
  const st = useProjectStore.getState()
  const name = await promptDialog({
    title: 'Rename project',
    label: 'Project name',
    defaultValue: st.project.name,
    confirmLabel: 'Rename'
  })
  if (name && name.trim()) st.setProjectMeta({ name: name.trim() })
}

export async function exportBom(): Promise<void> {
  try {
    const res = await exportBomCsv(useProjectStore.getState().project, getEffectiveLibrary().lib)
    if (!res.canceled && res.path) toast(`BOM exported to ${res.path}`, 'success')
  } catch (err) {
    toast(`BOM export failed: ${errMessage(err)}`, 'error')
  }
}

/** Offer the crash-recovery autosave, if one exists. */
export async function offerRecovery(): Promise<void> {
  try {
    const rec = await window.ww.project.getRecovery()
    if (!rec.exists || !rec.data) return
    const when = rec.savedAt ? new Date(rec.savedAt).toLocaleString() : 'earlier'
    const ok = await confirmDialog({
      title: 'Recover unsaved work?',
      message: `WireWeaver closed unexpectedly. An autosave from ${when} was found.`,
      detail: rec.path
        ? `Unsaved changes to:\n${rec.path}`
        : 'Recovering replaces the current untitled project.',
      confirmLabel: 'Recover',
      cancelLabel: 'Discard'
    })
    if (ok) {
      // Keep the original file association so Ctrl+S writes back to it.
      if (applyOpened(rec.data, rec.path, { recovered: true })) {
        toast('Recovered autosaved project.', 'success')
      }
    } else {
      await window.ww.project.clearRecovery()
    }
  } catch {
    /* recovery is best-effort */
  }
}
