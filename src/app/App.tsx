import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { ReactFlowProvider } from '@xyflow/react'
import {
  Cable,
  FolderOpen,
  Save,
  SaveAll,
  FilePlus2,
  Undo2,
  Redo2,
  PanelLeftClose,
  PanelLeftOpen,
  FileDown,
  Clock
} from 'lucide-react'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { Toaster, toast } from '../shared/toast'
import { LibraryPane } from '../library/LibraryPane'
import { AssemblyView } from '../assembly/AssemblyView'
import { Inspector } from '../inspector/Inspector'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { exportBomCsv } from '../model/bom'
import { withSnapshots, missingFromLibrary } from '../model/snapshot'
import type { Project } from '../model/types'

// Overlays are code-split: none are needed at first paint.
const PartEditor = lazy(() =>
  import('../library/PartEditor').then((m) => ({ default: m.PartEditor }))
)
const PinoutTemplateEditor = lazy(() =>
  import('../library/PinoutTemplateEditor').then((m) => ({
    default: m.PinoutTemplateEditor
  }))
)
const HarnessEditor = lazy(() =>
  import('../harness/HarnessEditor').then((m) => ({ default: m.HarnessEditor }))
)

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function App() {
  const loadLibrary = useLibraryStore((s) => s.load)
  const loaded = useLibraryStore((s) => s.loaded)

  const project = useProjectStore((s) => s.project)
  const filePath = useProjectStore((s) => s.filePath)
  const dirty = useProjectStore((s) => s.dirty)
  const markSaved = useProjectStore((s) => s.markSaved)
  const markDirty = useProjectStore((s) => s.markDirty)
  const loadProject = useProjectStore((s) => s.loadProject)
  const newProject = useProjectStore((s) => s.newProject)
  const duplicateInstance = useProjectStore((s) => s.duplicateInstance)

  // Subscribe to history so the buttons stay in sync with undo/redo state.
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0)

  const libraryCollapsed = useUiStore((s) => s.libraryCollapsed)
  const toggleLibrary = useUiStore((s) => s.toggleLibrary)
  const partEditor = useUiStore((s) => s.partEditor)
  const templateEditorId = useUiStore((s) => s.templateEditorId)
  const harnessEditorId = useUiStore((s) => s.harnessEditorId)

  const [recentProjects, setRecentProjects] = useState<
    { name: string; path: string; openedAt: number }[]
  >([])
  const [recentOpen, setRecentOpen] = useState(false)

  useEffect(() => {
    loadLibrary()
    window.ww.recent.get().then(setRecentProjects)
  }, [loadLibrary])

  useEffect(() => {
    window.ww.project.setDirty(dirty)
  }, [dirty])

  useEffect(() => {
    if (!recentOpen) return
    const close = () => setRecentOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [recentOpen])

  // Undo/redo mark the project dirty: after reverting past a save point the
  // file on disk no longer matches the store.
  const doUndo = useCallback(() => {
    const t = useProjectStore.temporal.getState()
    if (t.pastStates.length === 0) return
    t.undo()
    markDirty()
  }, [markDirty])

  const doRedo = useCallback(() => {
    const t = useProjectStore.temporal.getState()
    if (t.futureStates.length === 0) return
    t.redo()
    markDirty()
  }, [markDirty])

  const confirmDiscard = useCallback((): boolean => {
    if (!useProjectStore.getState().dirty) return true
    return window.confirm('You have unsaved changes. Discard them?')
  }, [])

  const handleSave = useCallback(
    async (forceDialog = false) => {
      try {
        const lib = useLibraryStore.getState()
        const data = withSnapshots(project, lib.parts, lib.templates)
        const res = await window.ww.project.save(
          forceDialog ? undefined : filePath,
          data
        )
        if (res.canceled || !res.path) return
        markSaved(res.path)
        window.ww.recent
          .add({ name: project.name, path: res.path })
          .then(setRecentProjects)
        toast(`Saved to ${res.path}`, 'success')
      } catch (err) {
        toast(`Save failed: ${errMessage(err)}`, 'error')
      }
    },
    [filePath, project, markSaved]
  )

  const applyOpened = useCallback(
    (data: Project, path: string) => {
      loadProject(data, path)
      useProjectStore.temporal.getState().clear()
      // Merge snapshot-only parts/templates into the library so a project from
      // another machine renders fully.
      const lib = useLibraryStore.getState()
      const missing = missingFromLibrary(data, lib.parts, lib.templates)
      if (missing.parts.length > 0 || missing.templates.length > 0) {
        for (const t of missing.templates) lib.upsertTemplate(t)
        for (const p of missing.parts) lib.upsertPart(p)
        toast(
          `Imported ${missing.parts.length} part(s) and ${missing.templates.length} template(s) from the project's snapshot.`,
          'info'
        )
      }
      window.ww.recent.add({ name: data.name, path }).then(setRecentProjects)
    },
    [loadProject]
  )

  const handleOpen = useCallback(async () => {
    if (!confirmDiscard()) return
    try {
      const res = await window.ww.project.open()
      if (!res.canceled && res.data && res.path) applyOpened(res.data, res.path)
    } catch (err) {
      toast(`Open failed: ${errMessage(err)}`, 'error')
    }
  }, [confirmDiscard, applyOpened])

  const handleOpenRecent = useCallback(
    async (path: string) => {
      if (!confirmDiscard()) return
      const res = await window.ww.project.openPath(path)
      if (!res.canceled && res.data && res.path) applyOpened(res.data, res.path)
      else toast(`Could not open ${path}`, 'error')
    },
    [confirmDiscard, applyOpened]
  )

  const handleNew = useCallback(() => {
    if (!confirmDiscard()) return
    newProject()
    useProjectStore.temporal.getState().clear()
    useUiStore.getState().select(null)
  }, [confirmDiscard, newProject])

  const handleBom = useCallback(async () => {
    try {
      const lib = selectLibraryLike(useLibraryStore.getState())
      const res = await exportBomCsv(project, lib)
      if (!res.canceled && res.path) toast(`BOM exported to ${res.path}`, 'success')
    } catch (err) {
      toast(`BOM export failed: ${errMessage(err)}`, 'error')
    }
  }, [project])

  const focusLibrarySearch = useCallback(() => {
    if (useUiStore.getState().libraryCollapsed) useUiStore.getState().toggleLibrary()
    setTimeout(
      () => document.getElementById('ww-library-search')?.focus(),
      0
    )
  }, [])

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 's' && e.shiftKey) {
        e.preventDefault()
        handleSave(true)
      } else if (key === 's') {
        e.preventDefault()
        handleSave()
      } else if (key === 'o') {
        e.preventDefault()
        handleOpen()
      } else if (key === 'n') {
        e.preventDefault()
        handleNew()
      } else if (key === 'f') {
        e.preventDefault()
        focusLibrarySearch()
      } else if (key === 'd') {
        e.preventDefault()
        const sel = useUiStore.getState().selection
        if (sel?.type === 'instance') duplicateInstance(sel.id)
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, handleOpen, handleNew, focusLibrarySearch, doUndo, doRedo, duplicateInstance])

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        {/* Title bar */}
        <header className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
          <div className="flex items-center gap-2 pr-2 font-semibold">
            <Cable size={18} className="text-accent" />
            WireWeaver
          </div>
          <div className="text-muted">
            {project.name}
            {dirty && <span className="text-accent"> •</span>}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button className="ww-btn" onClick={() => toggleLibrary()} title="Toggle library">
              {libraryCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
            <button
              className="ww-btn"
              onClick={doUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="ww-btn"
              onClick={doRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={16} />
            </button>
            <button className="ww-btn" onClick={handleBom} title="Export BOM (CSV)">
              <FileDown size={16} /> BOM
            </button>
            <button className="ww-btn" onClick={handleNew} title="New project (Ctrl+N)">
              <FilePlus2 size={16} /> New
            </button>

            <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="ww-btn"
                onClick={() => setRecentOpen((o) => !o)}
                title="Recent projects"
                disabled={recentProjects.length === 0}
              >
                <Clock size={16} /> Recent
              </button>
              {recentOpen && recentProjects.length > 0 && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[240px] rounded border border-edge bg-panel shadow-xl">
                  <div className="max-h-60 overflow-y-auto">
                    {recentProjects.map((r) => (
                      <button
                        key={r.path}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panelalt"
                        onClick={() => {
                          setRecentOpen(false)
                          handleOpenRecent(r.path)
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="truncate text-[10px] text-muted">{r.path}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button className="ww-btn" onClick={handleOpen} title="Open project (Ctrl+O)">
              <FolderOpen size={16} /> Open
            </button>
            <button
              className="ww-btn"
              onClick={() => handleSave(true)}
              title="Save As… (Ctrl+Shift+S)"
            >
              <SaveAll size={16} />
            </button>
            <button
              className="ww-btn-primary"
              onClick={() => handleSave()}
              title="Save project (Ctrl+S)"
            >
              <Save size={16} /> Save
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {!libraryCollapsed && <LibraryPane />}
          <main className="relative min-w-0 flex-1">
            {loaded ? (
              <ErrorBoundary>
                <AssemblyView />
              </ErrorBoundary>
            ) : (
              <div className="flex h-full items-center justify-center text-muted">
                Loading library…
              </div>
            )}
          </main>
          <Inspector />
        </div>
      </div>

      <Suspense fallback={null}>
        {partEditor && <PartEditor />}
        {templateEditorId !== undefined && <PinoutTemplateEditor />}
        {harnessEditorId && (
          <ErrorBoundary>
            <HarnessEditor harnessId={harnessEditorId} />
          </ErrorBoundary>
        )}
      </Suspense>

      <Toaster />
    </ReactFlowProvider>
  )
}
