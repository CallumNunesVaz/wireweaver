import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { CommandPalette, type Command as PaletteCommand } from '../shared/CommandPalette'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { Toaster, toast } from '../shared/toast'
import { DialogHost, promptDialog } from '../shared/dialogs'
import { isTextTarget, topOverlay } from '../shared/overlay'
import { LibraryPane } from '../library/LibraryPane'
import { AssemblyView } from '../assembly/AssemblyView'
import { Inspector } from '../inspector/Inspector'
import { useLibraryStore } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import type { MenuCommand } from '../ipc/contract'
import { TitleBar } from './TitleBar'
import { ProjectWatcher } from './ProjectWatcher'
import { useTheme } from './useTheme'
import {
  exportBom,
  newProject,
  offerRecovery,
  openProject,
  openProjectPath,
  refreshRecent,
  renameProject,
  saveProject,
  useRecentStore
} from './projectActions'

// Overlays are code-split: none are needed at first paint.
const PartEditor = lazy(() => import('../library/PartEditor').then((m) => ({ default: m.PartEditor })))
const PinoutTemplateEditor = lazy(() =>
  import('../library/PinoutTemplateEditor').then((m) => ({ default: m.PinoutTemplateEditor }))
)
const HarnessEditor = lazy(() => import('../harness/HarnessEditor').then((m) => ({ default: m.HarnessEditor })))
const ConnectPortsDialog = lazy(() =>
  import('../assembly/ConnectPortsDialog').then((m) => ({ default: m.ConnectPortsDialog }))
)
const LibraryManager = lazy(() => import('../library/LibraryManager').then((m) => ({ default: m.LibraryManager })))
const ReportsModal = lazy(() => import('../reports/ReportsModal').then((m) => ({ default: m.ReportsModal })))
const DrcPanel = lazy(() => import('../reports/DrcPanel').then((m) => ({ default: m.DrcPanel })))
const RevisionsPanel = lazy(() => import('../reports/RevisionsPanel').then((m) => ({ default: m.RevisionsPanel })))
const ShortcutCheatsheet = lazy(() =>
  import('../shared/ShortcutCheatsheet').then((m) => ({ default: m.ShortcutCheatsheet }))
)
const ReconciliationDialog = lazy(() =>
  import('../library/ReconciliationDialog').then((m) => ({ default: m.ReconciliationDialog }))
)
const CalculatorModal = lazy(() => import('../shared/CalculatorModal').then((m) => ({ default: m.CalculatorModal })))
const DocumentationDialog = lazy(() =>
  import('../shared/DocumentationDialog').then((m) => ({ default: m.DocumentationDialog }))
)

/** Undo/redo mark the project dirty: the file on disk no longer matches. */
function undo(): void {
  const t = useProjectStore.temporal.getState()
  if (t.pastStates.length === 0) return
  t.undo()
  useProjectStore.getState().markDirty()
}

function redo(): void {
  const t = useProjectStore.temporal.getState()
  if (t.futureStates.length === 0) return
  t.redo()
  useProjectStore.getState().markDirty()
}

async function renameSelection(): Promise<void> {
  const sel = useUiStore.getState().selection
  if (!sel) return
  const st = useProjectStore.getState()
  if (sel.type === 'instance') {
    const inst = st.project.deviceInstances.find((i) => i.id === sel.id)
    if (!inst) return
    const label = await promptDialog({
      title: 'Rename device',
      label: 'Instance label',
      defaultValue: inst.label,
      confirmLabel: 'Rename'
    })
    if (label && label.trim()) st.setInstanceLabel(sel.id, label.trim())
  } else {
    const h = st.project.harnesses.find((x) => x.id === sel.id)
    if (!h) return
    const name = await promptDialog({
      title: 'Rename harness',
      label: 'Harness name',
      defaultValue: h.name,
      confirmLabel: 'Rename'
    })
    if (name && name.trim()) st.updateHarness(sel.id, { name: name.trim() })
  }
}

function duplicateSelection(): void {
  const sel = useUiStore.getState().selection
  if (sel?.type === 'instance') useProjectStore.getState().duplicateInstance(sel.id)
  else if (sel?.type === 'harness') {
    // A copy would share the same device ports, which a port can't (one
    // harness per port). Reuse wiring via a subassembly instead.
    toast(
      "A harness can't be duplicated onto the same ports. Save it as a subassembly (Inspector) and insert it between other devices.",
      'info'
    )
  }
}

function focusLibrarySearch(): void {
  if (useUiStore.getState().libraryCollapsed) useUiStore.getState().toggleLibrary()
  setTimeout(() => document.getElementById('ww-library-search')?.focus(), 0)
}

function runMenuCommand(cmd: MenuCommand): void {
  const ui = useUiStore.getState()
  switch (cmd) {
    case 'new':
      return void newProject()
    case 'open':
      return void openProject()
    case 'save':
      return void saveProject()
    case 'saveAs':
      return void saveProject(true)
    case 'undo':
    case 'redo': {
      // Same rules as the keyboard shortcut: undo typing in a text field, and
      // leave the project alone behind an overlay that doesn't allow undo.
      if (isTextTarget(document.activeElement)) {
        document.execCommand(cmd)
        return
      }
      const top = topOverlay()
      if (top && !top.allowsUndo) return
      return cmd === 'undo' ? undo() : redo()
    }
    case 'reports':
      return ui.toggleReports()
    case 'library':
      return ui.toggleLibraryManager()
    case 'docs':
      return ui.toggleDocs()
    case 'shortcuts':
      return ui.toggleCheatsheet()
    case 'palette':
      return ui.toggleCommandPalette()
  }
}

export default function App() {
  const loadLibrary = useLibraryStore((s) => s.load)
  const loaded = useLibraryStore((s) => s.loaded)
  const projectId = useProjectStore((s) => s.project.id)

  const libraryCollapsed = useUiStore((s) => s.libraryCollapsed)
  const partEditor = useUiStore((s) => s.partEditor)
  const templateEditorId = useUiStore((s) => s.templateEditorId)
  const harnessEditorId = useUiStore((s) => s.harnessEditorId)
  const connectPortsInstanceId = useUiStore((s) => s.connectPortsInstanceId)
  const libraryManagerOpen = useUiStore((s) => s.libraryManagerOpen)
  const reportsOpen = useUiStore((s) => s.reportsOpen)
  const drcOpen = useUiStore((s) => s.drcOpen)
  const revisionsOpen = useUiStore((s) => s.revisionsOpen)
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen)
  const cheatsheetOpen = useUiStore((s) => s.cheatsheetOpen)
  const calculatorOpen = useUiStore((s) => s.calculatorOpen)
  const docsOpen = useUiStore((s) => s.docsOpen)
  const showReconciliation = useUiStore((s) => s.showReconciliation)
  const recent = useRecentStore((s) => s.recent)

  const theme = useTheme()

  // Startup: library and recents.
  useEffect(() => {
    void loadLibrary()
    void refreshRecent()
  }, [loadLibrary])

  // Then a file the OS opened us with, or else any crash-recovery autosave.
  useEffect(() => {
    if (!loaded) return
    void (async () => {
      const pending = await window.ww.app.takePendingFile().catch(() => null)
      if (pending) await openProjectPath(pending, false)
      else await offerRecovery()
    })()
  }, [loaded])

  // Main-process events: OS file opens, the close prompt's Save, the native menu.
  useEffect(() => {
    const offs = [
      window.ww.app.on('app:openFile', (path) => void openProjectPath(path)),
      window.ww.app.on('app:saveAndClose', () => {
        void saveProject().then(() => window.ww.app.closeAfterSave())
      }),
      window.ww.app.on('menu:command', runMenuCommand)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Global shortcuts. Project-level shortcuts only act on the main view: not
  // behind an open dialog, and never while typing in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const top = topOverlay()
      const inText = isTextTarget(e.target)
      const ui = useUiStore.getState()

      if (mod && key === 's') {
        e.preventDefault()
        void saveProject(e.shiftKey)
        return
      }
      if (mod && (key === 'z' || key === 'y')) {
        if (inText) return // native text undo/redo
        if (top && !top.allowsUndo) return
        e.preventDefault()
        if (key === 'y' || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.key === 'F1') {
        e.preventDefault()
        ui.toggleDocs()
        return
      }
      if (top) return

      if (mod) {
        const actions: Record<string, () => void> = {
          o: () => void openProject(),
          n: () => void newProject(),
          f: focusLibrarySearch,
          k: ui.toggleCommandPalette,
          d: duplicateSelection,
          l: ui.toggleLibraryManager,
          h: ui.toggleLibrary,
          b: () => void exportBom(),
          r: ui.toggleReports,
          e: () => {
            const sel = ui.selection
            if (sel?.type === 'harness') ui.openHarnessEditor(sel.id)
          }
        }
        const action = actions[key]
        // While typing, only Ctrl+S (handled above) acts on the project; every
        // other modifier key keeps its normal text-editing meaning.
        if (action && !inText) {
          e.preventDefault()
          action()
        }
        return
      }

      if (inText) return
      if (e.key === '?') {
        e.preventDefault()
        ui.toggleCheatsheet()
      } else if (e.key === 'F2') {
        e.preventDefault()
        void renameSelection()
      } else if (key === 'c' && ui.selection?.type === 'instance') {
        e.preventDefault()
        ui.openConnectPorts(ui.selection.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ui = useUiStore.getState
  const commands: PaletteCommand[] = useMemo(
    () => [
      { id: 'new', label: 'New project', hint: 'Ctrl+N', run: () => void newProject() },
      { id: 'open', label: 'Open project…', hint: 'Ctrl+O', run: () => void openProject() },
      { id: 'save', label: 'Save project', hint: 'Ctrl+S', run: () => void saveProject() },
      { id: 'saveas', label: 'Save project as…', hint: 'Ctrl+Shift+S', run: () => void saveProject(true) },
      { id: 'rename', label: 'Rename project…', run: () => void renameProject() },
      {
        id: 'connect',
        label: 'Connect ports…',
        hint: 'C',
        run: () => {
          const sel = ui().selection
          if (sel?.type === 'instance') ui().openConnectPorts(sel.id)
        }
      },
      { id: 'bom', label: 'Export BOM (CSV)', hint: 'Ctrl+B', run: () => void exportBom() },
      { id: 'reports', label: 'Reports & exports', hint: 'Ctrl+R', run: () => ui().toggleReports() },
      { id: 'library', label: 'Library Manager', hint: 'Ctrl+L', run: () => ui().toggleLibraryManager() },
      { id: 'librarypane', label: 'Toggle library pane', hint: 'Ctrl+H', run: () => ui().toggleLibrary() },
      { id: 'drc', label: 'Design rule check', run: () => ui().toggleDrc() },
      { id: 'revisions', label: 'Project revisions', run: () => ui().toggleRevisions() },
      { id: 'calc', label: 'Voltage drop calculator', run: () => ui().toggleCalculator() },
      { id: 'docs', label: 'Documentation', hint: 'F1', run: () => ui().toggleDocs() },
      { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', run: () => ui().toggleCheatsheet() },
      { id: 'theme', label: 'Cycle theme (system / light / dark)', run: theme.cycle },
      ...recent.map((r) => ({
        id: `recent-${r.path}`,
        label: `Open recent: ${r.name}`,
        hint: r.path,
        run: () => void openProjectPath(r.path)
      }))
    ],
    [ui, theme.cycle, recent]
  )

  const closePartEditor = useCallback(() => ui().closePartEditor(), [ui])

  return (
    <ReactFlowProvider>
      <ProjectWatcher />
      <div className="flex h-full flex-col">
        <TitleBar theme={theme.pref} onCycleTheme={theme.cycle} onUndo={undo} onRedo={redo} />
        <LibraryErrorBanner />

        <div className="flex min-h-0 flex-1">
          {!libraryCollapsed && <LibraryPane />}
          <main className="relative min-w-0 flex-1" aria-label="Assembly canvas">
            {loaded ? (
              <ErrorBoundary resetKey={projectId} label="the assembly view">
                <AssemblyView />
              </ErrorBoundary>
            ) : (
              <div className="flex h-full items-center justify-center text-muted">Loading library…</div>
            )}
          </main>
          <Inspector />
          {drcOpen && (
            <Suspense fallback={null}>
              <ErrorBoundary label="the design rule check">
                <DrcPanel />
              </ErrorBoundary>
            </Suspense>
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        {libraryManagerOpen && (
          <ErrorBoundary label="the Library Manager">
            <LibraryManager />
          </ErrorBoundary>
        )}
        {harnessEditorId && (
          <ErrorBoundary resetKey={harnessEditorId} label="the harness editor">
            <HarnessEditor harnessId={harnessEditorId} />
          </ErrorBoundary>
        )}
        {connectPortsInstanceId != null && (
          <ConnectPortsDialog
            instanceId={connectPortsInstanceId}
            onClose={() => ui().closeConnectPorts()}
          />
        )}
        {partEditor && <PartEditor onClose={closePartEditor} />}
        {templateEditorId !== undefined && <PinoutTemplateEditor />}
        {reportsOpen && (
          <ErrorBoundary label="reports">
            <ReportsModal />
          </ErrorBoundary>
        )}
        {revisionsOpen && (
          <ErrorBoundary label="revisions">
            <RevisionsPanel />
          </ErrorBoundary>
        )}
        {cheatsheetOpen && <ShortcutCheatsheet onClose={() => ui().toggleCheatsheet()} />}
        {showReconciliation && <ReconciliationDialog />}
        {calculatorOpen && <CalculatorModal onClose={() => ui().toggleCalculator()} />}
        {docsOpen && <DocumentationDialog onClose={() => ui().toggleDocs()} />}
      </Suspense>

      {commandPaletteOpen && <CommandPalette commands={commands} />}
      <Toaster />
      <DialogHost />
    </ReactFlowProvider>
  )
}

/** Shown when library records could not be read. */
function LibraryErrorBanner() {
  const error = useLibraryStore((s) => s.loadError)
  const load = useLibraryStore((s) => s.load)
  const startFresh = useLibraryStore((s) => s.acceptEmptyLibrary)
  if (!error) return null
  return (
    <div role="alert" className="flex items-start gap-3 border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Some library records could not be read.</div>
        <div className="whitespace-pre-line text-muted">{error}</div>
        <div className="text-muted">Library changes are not being saved until you choose an option.</div>
      </div>
      <button className="ww-btn" onClick={() => void load()}>
        Retry
      </button>
      <button className="ww-btn" onClick={startFresh}>
        Continue and save
      </button>
    </div>
  )
}
