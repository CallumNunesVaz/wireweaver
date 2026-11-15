import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  BookOpen,
  Cable,
  Calculator,
  Clock,
  Command,
  FileDown,
  FilePlus2,
  FileText,
  FolderOpen,
  HelpCircle,
  History,
  Keyboard,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Redo2,
  Save,
  SaveAll,
  ShieldCheck,
  Sun,
  Undo2,
  Wrench
} from 'lucide-react'
import { MenuButton } from '../shared/MenuButton'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useDrcIssues } from '../stores/effectiveLibrary'
import type { ThemePreference } from '../ipc/contract'
import {
  exportBom,
  newProject,
  openProject,
  openProjectPath,
  saveProject,
  useRecentStore
} from './projectActions'

export interface TitleBarProps {
  theme: ThemePreference
  onCycleTheme: () => void
  onUndo: () => void
  onRedo: () => void
}

const THEME_META: Record<ThemePreference, { icon: JSX.Element; label: string }> = {
  system: { icon: <Monitor size={16} />, label: 'Theme: follow system (click for light)' },
  light: { icon: <Sun size={16} />, label: 'Theme: light (click for dark)' },
  dark: { icon: <Moon size={16} />, label: 'Theme: dark (click to follow system)' }
}

export function TitleBar({ theme, onCycleTheme, onUndo, onRedo }: TitleBarProps) {
  const dirty = useProjectStore((s) => s.dirty)
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0)
  const libraryCollapsed = useUiStore((s) => s.libraryCollapsed)
  const ui = useUiStore.getState
  const recent = useRecentStore((s) => s.recent)

  const projectMenu = [
    { label: 'New project', icon: <FilePlus2 size={14} />, onClick: () => void newProject() },
    { label: 'Open project…', icon: <FolderOpen size={14} />, onClick: () => void openProject() },
    { label: 'Save', icon: <Save size={14} />, onClick: () => void saveProject() },
    { label: 'Save As…', icon: <SaveAll size={14} />, onClick: () => void saveProject(true) },
    ...recent.slice(0, 5).map((r) => ({
      label: `Recent: ${r.name}`,
      icon: <Clock size={14} />,
      onClick: () => void openProjectPath(r.path)
    }))
  ]

  const toolsMenu = [
    { label: 'Reports & exports', icon: <FileText size={14} />, onClick: () => ui().toggleReports() },
    { label: 'Export BOM (CSV)', icon: <FileDown size={14} />, onClick: () => void exportBom() },
    { label: 'Library Manager', icon: <BookOpen size={14} />, onClick: () => ui().toggleLibraryManager() },
    { label: 'Project revisions', icon: <History size={14} />, onClick: () => ui().toggleRevisions() },
    { label: 'Voltage drop calculator', icon: <Calculator size={14} />, onClick: () => ui().toggleCalculator() },
    { label: 'Documentation', icon: <HelpCircle size={14} />, onClick: () => ui().toggleDocs() },
    { label: 'Keyboard shortcuts', icon: <Keyboard size={14} />, onClick: () => ui().toggleCheatsheet() }
  ]

  return (
    <header className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
      <div className="flex items-center gap-2 pr-1 font-semibold">
        <Cable size={18} className="text-accent" aria-hidden />
        WireWeaver
      </div>
      <ProjectName dirty={dirty} />

      <div className="ml-auto flex items-center gap-1">
        <IconButton label={THEME_META[theme].label} onClick={onCycleTheme}>
          {THEME_META[theme].icon}
        </IconButton>
        <IconButton
          label={libraryCollapsed ? 'Show library (Ctrl+H)' : 'Hide library (Ctrl+H)'}
          onClick={() => ui().toggleLibrary()}
        >
          {libraryCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
        <IconButton label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
        <DrcButton />
        <IconButton label="Command palette (Ctrl+K)" onClick={() => ui().toggleCommandPalette()}>
          <Command size={16} />
        </IconButton>
        <MenuButton label="Project" icon={<FolderOpen size={15} />} items={projectMenu} title="Project actions" />
        <MenuButton label="Tools" icon={<Wrench size={15} />} items={toolsMenu} title="Tools & exports" />
        <button className="ww-btn-primary" onClick={() => void saveProject()} title="Save project (Ctrl+S)">
          <Save size={16} aria-hidden /> Save
        </button>
      </div>
    </header>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button className="ww-btn" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      {children}
    </button>
  )
}

/** The project name; click to rename in place. */
function ProjectName({ dirty }: { dirty: boolean }) {
  const name = useProjectStore((s) => s.project.name)
  const setMeta = useProjectStore((s) => s.setProjectMeta)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const v = draft.trim()
    if (v && v !== name) setMeta({ name: v })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="ww-input w-56"
        aria-label="Project name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-muted hover:bg-panelalt hover:text-ink"
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      title="Rename project"
    >
      <span className="max-w-[320px] truncate">{name}</span>
      {dirty && (
        <span className="text-accent" aria-label="unsaved changes" title="Unsaved changes">
          •
        </span>
      )}
      <Pencil size={12} className="opacity-0 group-hover:opacity-100" aria-hidden />
    </button>
  )
}

function DrcButton() {
  const issues = useDrcIssues()
  const errors = issues.filter((i) => i.severity === 'error').length
  const label =
    issues.length === 0
      ? 'Design rule check: no issues'
      : `Design rule check: ${errors} error${errors === 1 ? '' : 's'}, ${issues.length - errors} warning${
          issues.length - errors === 1 ? '' : 's'
        }`
  return (
    <button className="ww-btn" onClick={() => useUiStore.getState().toggleDrc()} title={label} aria-label={label}>
      <ShieldCheck size={16} aria-hidden /> DRC
      {issues.length > 0 && (
        <span
          className={`ml-0.5 rounded-full px-1.5 text-[11px] font-semibold ${
            errors > 0 ? 'bg-danger text-accent-ink' : 'bg-warn text-accent-ink'
          }`}
        >
          {issues.length}
        </span>
      )}
    </button>
  )
}
