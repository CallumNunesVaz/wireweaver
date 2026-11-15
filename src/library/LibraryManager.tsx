import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Cable,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  Filter,
  FolderSync,
  ListTree,
  PackagePlus,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { useLibraryStore } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useEffectiveLibrary } from '../stores/effectiveLibrary'
import { fuzzySearch } from './FuzzySearch'
import { toast } from '../shared/toast'
import { choiceDialog } from '../shared/dialogs'
import { confirmDiscardEdits } from '../shared/Modal'
import { imageUrl } from '../shared/useImage'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { useFocusTrap, useOverlay } from '../shared/overlay'
import { resolveEndpoint } from '../model/derivation'
import {
  endLabel,
  isConnector,
  isDevice,
  isWire,
  type ConnectorGender,
  type Harness,
  type Part,
  type PinoutTemplate,
  type WirePart
} from '../model/types'
import { PartForm, blankPart, validatePart } from './PartForm'
import { TemplateForm, blankTemplate, finalizeTemplate, validateTemplate } from './TemplateForm'
import {
  deleteMany,
  deletePart,
  deleteTemplate,
  duplicatePart,
  exportLibraryFile,
  importLibraryFile,
  importWireVizFile,
  installPack,
  partReferences,
  templateReferences
} from './libraryActions'

type SectionKey = 'device' | 'connector' | 'wire' | 'template' | 'harness'
type NewKind = 'device' | 'connector' | 'wire'

type Selection =
  | { kind: 'part'; id: string }
  | { kind: 'template'; id: string }
  | { kind: 'harness'; id: string }
  | { kind: 'new-part'; partKind: NewKind }
  | { kind: 'new-template' }
  | null

type Row =
  | { type: 'header'; key: SectionKey; count: number; open: boolean }
  | { type: 'part'; part: Part }
  | { type: 'template'; template: PinoutTemplate }
  | { type: 'harness'; harness: Harness }
  | { type: 'empty'; key: SectionKey }

const SECTIONS: { key: SectionKey; label: string; short: string; icon: typeof Cpu; create?: NewKind | 'template' }[] = [
  { key: 'device', label: 'Devices', short: 'Devices', icon: Cpu, create: 'device' },
  { key: 'connector', label: 'Connectors', short: 'Connectors', icon: Plug, create: 'connector' },
  { key: 'wire', label: 'Wires', short: 'Wires', icon: Cable, create: 'wire' },
  { key: 'template', label: 'Pinout templates', short: 'Templates', icon: ListTree, create: 'template' },
  { key: 'harness', label: 'Project harnesses', short: 'Harnesses', icon: Cable }
]

const WIRE_FILTER_FIELDS: { key: keyof WirePart; label: string }[] = [
  { key: 'gauge', label: 'Gauge' },
  { key: 'conductors', label: 'Conductors' },
  { key: 'shield', label: 'Shield' },
  { key: 'colorCode', label: 'Colour code' },
  { key: 'jacketMaterial', label: 'Jacket' },
  { key: 'voltageRating', label: 'Voltage' },
  { key: 'ulStyle', label: 'UL style' },
  { key: 'outerDiameterMm', label: 'OD (mm)' },
  { key: 'operatingTemperature', label: 'Temp.' },
  { key: 'color', label: 'Colour' },
  { key: 'insulatorColor', label: 'Insulator' },
  { key: 'cableStyle', label: 'Cable style' },
  { key: 'category', label: 'Category' }
]

export function LibraryManager() {
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const libraryPath = useLibraryStore((s) => s.libraryPath)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const upsertTemplate = useLibraryStore((s) => s.upsertTemplate)
  const harnesses = useProjectStore((s) => s.project.harnesses)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const closeManager = useUiStore((s) => s.toggleLibraryManager)

  const [selection, setSelection] = useState<Selection>(null)
  const [partDraft, setPartDraft] = useState<{ initial: Part; draft: Part } | null>(null)
  const [tplDraft, setTplDraft] = useState<{ initial: PinoutTemplate; draft: PinoutTemplate } | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [shown, setShown] = useState<Record<SectionKey, boolean>>({
    device: true,
    connector: true,
    wire: true,
    template: true,
    harness: true
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [wireFilters, setWireFilters] = useState<Record<string, string>>({})
  const [pinCount, setPinCount] = useState('')
  const [gender, setGender] = useState<ConnectorGender | ''>('')
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null)
  const [packsOpen, setPacksOpen] = useState(false)
  const [packs, setPacks] = useState<{ id: string; name: string; parts: number; templates: number }[]>([])
  const [installing, setInstalling] = useState<string | null>(null)

  const dirty =
    (!!partDraft && partDraft.draft !== partDraft.initial) || (!!tplDraft && tplDraft.draft !== tplDraft.initial)

  /** Leave the current item, asking first if it has unsaved edits. */
  const guard = useCallback(
    async (then: () => void) => {
      if (dirty && !(await confirmDiscardEdits())) return
      then()
    },
    [dirty]
  )

  const requestClose = useCallback(() => void guard(closeManager), [guard, closeManager])
  const z = useOverlay(requestClose, { kind: 'workspace' })
  const rootRef = useRef<HTMLDivElement>(null)
  useFocusTrap(rootRef)

  const select = useCallback(
    (next: Selection) =>
      void guard(() => {
        setSelection(next)
        setPartDraft(null)
        setTplDraft(null)
        if (next?.kind === 'part') {
          const p = useLibraryStore.getState().parts.find((x) => x.id === next.id)
          if (p) {
            const initial = structuredClone(p)
            setPartDraft({ initial, draft: initial })
          }
        } else if (next?.kind === 'new-part') {
          const initial = blankPart(next.partKind)
          setPartDraft({ initial, draft: initial })
        } else if (next?.kind === 'template') {
          const t = useLibraryStore.getState().templates.find((x) => x.id === next.id)
          if (t) {
            const initial = structuredClone(t)
            setTplDraft({ initial, draft: initial })
          }
        } else if (next?.kind === 'new-template') {
          const initial = blankTemplate()
          setTplDraft({ initial, draft: initial })
        }
      }),
    [guard]
  )

  const clearSelection = () => {
    setSelection(null)
    setPartDraft(null)
    setTplDraft(null)
  }

  // ---------- Filtering ----------

  const connectors = useMemo(() => parts.filter(isConnector), [parts])
  const allWires = useMemo(() => parts.filter(isWire), [parts])

  const wireFilterOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const { key } of WIRE_FILTER_FIELDS) {
      const vals = new Set<string>()
      for (const w of allWires) {
        const v = w[key]
        if (v != null && v !== '') vals.add(String(v))
      }
      out[key] = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }
    return out
  }, [allWires])

  const activeFilterCount =
    Object.values(wireFilters).filter(Boolean).length + (pinCount ? 1 : 0) + (gender ? 1 : 0)

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase()
    const matched = fuzzySearch(parts, search)
    const devices = matched.filter(isDevice)
    const conns = matched
      .filter(isConnector)
      .filter((c) => (!pinCount || c.positions === Number(pinCount)) && (!gender || c.gender === gender))
    const wires = matched
      .filter(isWire)
      .filter((w) =>
        Object.entries(wireFilters).every(([k, v]) => !v || String(w[k as keyof WirePart] ?? '') === v)
      )
    const tpls = q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates
    const hs = q ? harnesses.filter((h) => h.name.toLowerCase().includes(q)) : harnesses

    const groups: Record<SectionKey, Row[]> = {
      device: devices.map((part) => ({ type: 'part', part })),
      connector: conns.map((part) => ({ type: 'part', part })),
      wire: wires.map((part) => ({ type: 'part', part })),
      template: tpls.map((template) => ({ type: 'template', template })),
      harness: hs.map((harness) => ({ type: 'harness', harness }))
    }
    const out: Row[] = []
    for (const s of SECTIONS) {
      if (!shown[s.key]) continue
      const items = groups[s.key]
      const open = !collapsed[s.key] || !!q
      out.push({ type: 'header', key: s.key, count: items.length, open })
      if (!open) continue
      if (items.length === 0) out.push({ type: 'empty', key: s.key })
      else out.push(...items)
    }
    return out
  }, [parts, templates, harnesses, search, shown, collapsed, wireFilters, pinCount, gender])

  // ---------- Actions ----------

  useEffect(() => {
    if (!packsOpen) return
    window.ww.library.listPacks().then(setPacks).catch(() => setPacks([]))
  }, [packsOpen])

  const changeDbFolder = useCallback(async () => {
    const path = await window.ww.library.choosePath()
    if (!path || path === libraryPath) return
    const choice = await choiceDialog({
      title: 'Change library folder',
      message: 'How should WireWeaver use this folder?',
      detail: `Current: ${libraryPath}\nNew: ${path}\n\n“Copy my library” copies your current library there (anything already in the folder is kept as a backup). “Use as-is” switches to whatever library the folder already contains.`,
      choices: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'switch', label: 'Use as-is' },
        { value: 'copy', label: 'Copy my library', primary: true }
      ]
    })
    if (choice !== 'copy' && choice !== 'switch') return
    try {
      const lib = useLibraryStore.getState()
      if (choice === 'copy') await lib.relocateLibrary(path)
      else await lib.setLibraryPath(path)
      clearSelection()
      toast(`Library folder: ${path}`, 'success')
    } catch (err) {
      toast(`Could not change library folder: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [libraryPath])

  const savePart = () => {
    if (!partDraft) return
    const problem = validatePart(partDraft.draft)
    if (problem) return toast(problem, 'error')
    upsertPart(partDraft.draft)
    setSelection({ kind: 'part', id: partDraft.draft.id })
    setPartDraft({ initial: partDraft.draft, draft: partDraft.draft })
    toast(`Saved "${partDraft.draft.name}".`, 'success')
  }

  const saveTemplate = () => {
    if (!tplDraft) return
    const problem = validateTemplate(tplDraft.draft)
    if (problem) return toast(problem, 'error')
    const t = finalizeTemplate(tplDraft.draft, connectors)
    upsertTemplate(t)
    setSelection({ kind: 'template', id: t.id })
    setTplDraft({ initial: t, draft: t })
    toast(`Saved "${t.name}".`, 'success')
  }

  const partMenu = (p: Part): CtxItem[] => [
    { label: 'Edit', icon: <Pencil size={14} />, onClick: () => select({ kind: 'part', id: p.id }) },
    {
      label: 'Duplicate',
      icon: <Copy size={14} />,
      onClick: () => select({ kind: 'part', id: duplicatePart(p).id })
    },
    {
      label: 'Delete…',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: async () => {
        if ((await deletePart(p)) && selection?.kind === 'part' && selection.id === p.id) clearSelection()
      }
    }
  ]

  const templateMenu = (t: PinoutTemplate): CtxItem[] => [
    { label: 'Edit', icon: <Pencil size={14} />, onClick: () => select({ kind: 'template', id: t.id }) },
    {
      label: 'Delete…',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: async () => {
        if ((await deleteTemplate(t)) && selection?.kind === 'template' && selection.id === t.id) clearSelection()
      }
    }
  ]

  const rowId = (r: Row): string =>
    r.type === 'part'
      ? r.part.id
      : r.type === 'template'
        ? r.template.id
        : r.type === 'harness'
          ? r.harness.id
          : `${r.type}-${r.key}`

  const toggleCheck = (id: string) =>
    setChecked((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 flex flex-col bg-panel"
      style={{ zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label="Library Manager"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <BookOpen size={18} className="text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Library Manager</h2>
        <span className="text-[11px] text-muted">
          {parts.length} parts · {templates.length} templates
        </span>
        {libraryPath && (
          <span className="max-w-[320px] truncate text-[11px] text-muted" title={libraryPath}>
            {libraryPath}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button className="ww-btn" onClick={() => void changeDbFolder()} title="Change the folder the library is stored in">
            <FolderSync size={14} /> Folder…
          </button>
          <button
            className={`ww-btn ${packsOpen ? 'border-accent text-accent' : ''}`}
            onClick={() => setPacksOpen((o) => !o)}
            aria-expanded={packsOpen}
          >
            <PackagePlus size={14} /> Starter packs
          </button>
          <button className="ww-btn" onClick={() => void importLibraryFile()} title="Import a .wwlib library file">
            <Upload size={14} /> Import
          </button>
          <button className="ww-btn" onClick={() => void importWireVizFile()} title="Import parts & templates from WireViz YAML">
            <Upload size={14} /> WireViz
          </button>
          <button className="ww-btn" onClick={() => void exportLibraryFile()} title="Export the library as a .wwlib file">
            <Download size={14} /> Export
          </button>
          <button
            className={`ww-btn ${selecting ? 'border-accent' : ''}`}
            onClick={() => {
              setSelecting(!selecting)
              setChecked(new Set())
            }}
            aria-pressed={selecting}
          >
            {selecting ? 'Done selecting' : 'Select…'}
          </button>
          {selecting && checked.size > 0 && (
            <button
              className="ww-btn text-danger"
              onClick={async () => {
                const removed = await deleteMany([...checked])
                if (removed.length) {
                  setChecked(new Set())
                  if (selection && 'id' in selection && removed.includes(selection.id)) clearSelection()
                }
              }}
            >
              <Trash2 size={14} /> Delete {checked.size}…
            </button>
          )}
          <button className="ww-btn ml-1" onClick={requestClose} title="Close (Esc)" aria-label="Close Library Manager">
            <X size={16} />
          </button>
        </div>
      </div>

      {packsOpen && (
        <div className="border-b border-edge bg-panelalt px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Bundled starter packs</div>
          {packs.length === 0 ? (
            <div className="text-[11px] text-muted">No bundled packs found.</div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {packs.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded border border-edge bg-panel px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium capitalize">{p.name}</div>
                    <div className="text-[11px] text-muted">
                      {p.parts} parts · {p.templates} templates
                    </div>
                  </div>
                  <button
                    className="ww-btn shrink-0"
                    disabled={installing !== null}
                    onClick={async () => {
                      setInstalling(p.id)
                      await installPack(p.id)
                      setInstalling(null)
                    }}
                  >
                    {installing === p.id ? 'Installing…' : 'Install'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-72 shrink-0 flex-col border-r border-edge">
          <div className="space-y-2 border-b border-edge p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="ww-input pl-7"
                placeholder="Search…"
                aria-label="Search the library"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  aria-pressed={shown[s.key]}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    shown[s.key] ? 'bg-accent text-accent-ink' : 'bg-panelalt text-muted hover:text-ink'
                  }`}
                  onClick={() => setShown((f) => ({ ...f, [s.key]: !f[s.key] }))}
                >
                  {s.short}
                </button>
              ))}
            </div>
            <button
              className={`flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] ${
                filtersOpen ? 'bg-accent/15 text-accent' : 'bg-panelalt text-muted hover:text-ink'
              }`}
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
            >
              <Filter size={11} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
            {filtersOpen && (
              <div className="space-y-1">
                {activeFilterCount > 0 && (
                  <button
                    className="flex items-center gap-1 text-[11px] text-muted hover:text-ink"
                    onClick={() => {
                      setWireFilters({})
                      setPinCount('')
                      setGender('')
                    }}
                  >
                    <RotateCcw size={11} /> Clear filters
                  </button>
                )}
                <div className="text-[11px] text-muted">Connectors</div>
                <div className="grid grid-cols-2 gap-1">
                  <select className="ww-input py-0.5 text-[11px]" value={pinCount} aria-label="Pin count" onChange={(e) => setPinCount(e.target.value)}>
                    <option value="">Any pin count</option>
                    {[...new Set(connectors.map((c) => c.positions))]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={String(n)}>
                          {n}-pos
                        </option>
                      ))}
                  </select>
                  <select
                    className="ww-input py-0.5 text-[11px]"
                    value={gender}
                    aria-label="Gender"
                    onChange={(e) => setGender(e.target.value as ConnectorGender | '')}
                  >
                    <option value="">Any gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="hermaphroditic">Hermaphroditic</option>
                  </select>
                </div>
                <div className="text-[11px] text-muted">Wires</div>
                <div className="grid grid-cols-2 gap-1">
                  {WIRE_FILTER_FIELDS.map(({ key, label }) => {
                    const values = wireFilterOptions[key]
                    if (!values || values.length <= 1) return null
                    return (
                      <select
                        key={key}
                        className="ww-input py-0.5 text-[11px]"
                        aria-label={label}
                        value={wireFilters[key] ?? ''}
                        onChange={(e) => setWireFilters({ ...wireFilters, [key]: e.target.value })}
                      >
                        <option value="">{label}: any</option>
                        {values.map((v) => (
                          <option key={v} value={v}>
                            {key === 'shield' ? (v === 'true' ? 'Shielded' : 'Unshielded') : v}
                          </option>
                        ))}
                      </select>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <Virtuoso
              style={{ height: '100%' }}
              data={rows}
              computeItemKey={(_, r) => `${r.type}-${rowId(r)}`}
              itemContent={(_, row) => {
                if (row.type === 'header') {
                  const s = SECTIONS.find((x) => x.key === row.key)!
                  const Icon = s.icon
                  return (
                    <div className="flex items-center gap-1 border-t border-edge/60 px-2 pb-1 pt-2">
                      <button
                        className="flex flex-1 items-center gap-1.5 text-left text-muted hover:text-ink"
                        aria-expanded={row.open}
                        onClick={() => setCollapsed((c) => ({ ...c, [row.key]: !c[row.key] }))}
                      >
                        {row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <Icon size={14} aria-hidden />
                        <span className="text-[11px] font-medium uppercase tracking-wide">{s.label}</span>
                        <span className="text-[11px]">({row.count})</span>
                      </button>
                      {s.create && (
                        <button
                          className="ww-icon-btn"
                          title={`New ${s.create}`}
                          aria-label={`New ${s.create}`}
                          onClick={() =>
                            select(
                              s.create === 'template'
                                ? { kind: 'new-template' }
                                : { kind: 'new-part', partKind: s.create as NewKind }
                            )
                          }
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
                  )
                }
                if (row.type === 'empty') {
                  return <div className="px-3 pb-2 text-[11px] text-muted">None.</div>
                }
                const id = rowId(row)
                const isSelected = !!selection && 'id' in selection && selection.id === id
                let title: string
                let subtitle: string
                let thumb: string | null = null
                let icon = <ListTree size={12} className="text-muted" />
                let menuItems: CtxItem[]
                let target: Selection
                if (row.type === 'part') {
                  title = row.part.name || '(unnamed)'
                  subtitle = row.part.internalPartNumber || row.part.manufacturerPartNumber || row.part.type
                  thumb = imageUrl(row.part.imageHash, 'thumb')
                  menuItems = partMenu(row.part)
                  target = { kind: 'part', id }
                  icon = <span className="text-[11px] text-muted">{row.part.type}</span>
                } else if (row.type === 'template') {
                  title = row.template.name || '(unnamed)'
                  subtitle = `${row.template.pins.length} pins`
                  menuItems = templateMenu(row.template)
                  target = { kind: 'template', id }
                } else {
                  title = row.harness.name || '(unnamed)'
                  subtitle = `${row.harness.wires.length} wires · ${row.harness.endpoints.length} ends`
                  icon = <Cable size={12} className="text-muted" />
                  menuItems = [
                    { label: 'Open harness editor', icon: <Pencil size={14} />, onClick: () => openHarnessEditor(id) }
                  ]
                  target = { kind: 'harness', id }
                }
                const canCheck = selecting && row.type !== 'harness'
                return (
                  <div className="px-2 py-0.5">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      className={`flex cursor-pointer items-center gap-2 rounded border p-1.5 text-xs hover:border-accent ${
                        isSelected ? 'border-accent bg-accent/10' : 'border-edge bg-panelalt'
                      }`}
                      onClick={() => (canCheck ? toggleCheck(id) : select(target))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (canCheck) toggleCheck(id)
                          else select(target)
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ x: e.clientX, y: e.clientY, items: menuItems })
                      }}
                    >
                      {canCheck && (
                        <input
                          type="checkbox"
                          checked={checked.has(id)}
                          onChange={() => toggleCheck(id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 accent-accent"
                          aria-label={`Select ${title}`}
                        />
                      )}
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
                        {thumb ? <img src={thumb} className="h-full w-full object-cover" alt="" /> : icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{title}</div>
                        <div className="truncate text-[11px] text-muted">{subtitle}</div>
                      </div>
                    </div>
                  </div>
                )
              }}
            />
          </div>
        </div>

        {/* Detail pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selection ? (
            <div className="flex h-full items-center justify-center text-muted">
              <div className="text-center">
                <BookOpen size={28} className="mx-auto mb-2" aria-hidden />
                <div className="text-sm">Select an item to view or edit it.</div>
                <div className="text-[11px]">Use + on a section to create something new.</div>
              </div>
            </div>
          ) : selection.kind === 'harness' ? (
            <HarnessDetail harnessId={selection.id} onOpenEditor={() => openHarnessEditor(selection.id)} />
          ) : (selection.kind === 'template' || selection.kind === 'new-template') && tplDraft ? (
            <DetailShell
              title={selection.kind === 'new-template' ? 'New pinout template' : 'Pinout template'}
              dirty={tplDraft.draft !== tplDraft.initial}
              isNew={selection.kind === 'new-template'}
              onSave={saveTemplate}
              onDiscard={() => setTplDraft({ initial: tplDraft.initial, draft: tplDraft.initial })}
              onDelete={
                selection.kind === 'template'
                  ? async () => {
                      const t = templates.find((x) => x.id === selection.id)
                      if (t && (await deleteTemplate(t))) clearSelection()
                    }
                  : undefined
              }
              usage={selection.kind === 'template' ? templateReferences(selection.id) : []}
            >
              <TemplateForm
                draft={tplDraft.draft}
                onChange={(draft) => setTplDraft({ ...tplDraft, draft })}
                connectors={connectors}
              />
            </DetailShell>
          ) : partDraft ? (
            <DetailShell
              title={selection.kind === 'new-part' ? `New ${partDraft.draft.kind}` : partDraft.draft.kind}
              dirty={partDraft.draft !== partDraft.initial}
              isNew={selection.kind === 'new-part'}
              onSave={savePart}
              onDiscard={() => setPartDraft({ initial: partDraft.initial, draft: partDraft.initial })}
              onDelete={
                selection.kind === 'part'
                  ? async () => {
                      const p = parts.find((x) => x.id === selection.id)
                      if (p && (await deletePart(p))) clearSelection()
                    }
                  : undefined
              }
              onDuplicate={
                selection.kind === 'part'
                  ? () => {
                      const p = parts.find((x) => x.id === selection.id)
                      if (p) select({ kind: 'part', id: duplicatePart(p).id })
                    }
                  : undefined
              }
              usage={selection.kind === 'part' ? partReferences(selection.id) : []}
            >
              <PartForm
                draft={partDraft.draft}
                onChange={(draft) => setPartDraft({ ...partDraft, draft })}
                templates={templates}
                connectors={connectors.map((c) => ({ id: c.id, name: c.name }))}
                onNewTemplate={() => select({ kind: 'new-template' })}
              />
            </DetailShell>
          ) : (
            <div className="flex h-full items-center justify-center text-muted">This item no longer exists.</div>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

function DetailShell({
  title,
  dirty,
  isNew,
  onSave,
  onDiscard,
  onDelete,
  onDuplicate,
  usage,
  children
}: {
  title: string
  dirty: boolean
  isNew: boolean
  onSave: () => void
  onDiscard: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  usage: string[]
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {dirty && <span className="text-[11px] text-accent">Unsaved changes</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {children}
        {!isNew && (
          <div className="mt-4 border-t border-edge pt-3">
            <div className="ww-label">Used by</div>
            {usage.length === 0 ? (
              <div className="text-[11px] text-muted">Not used by any part or by the current project.</div>
            ) : (
              <ul className="space-y-0.5 text-[11px] text-muted">
                {usage.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
        {onDelete && (
          <button className="ww-btn" onClick={onDelete}>
            <Trash2 size={14} /> Delete…
          </button>
        )}
        {onDuplicate && (
          <button className="ww-btn" onClick={onDuplicate}>
            <Copy size={14} /> Duplicate
          </button>
        )}
        <div className="flex-1" />
        {dirty && !isNew && (
          <button className="ww-btn" onClick={onDiscard}>
            Discard changes
          </button>
        )}
        <button className="ww-btn-primary" onClick={onSave} disabled={!dirty && !isNew}>
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function HarnessDetail({ harnessId, onOpenEditor }: { harnessId: string; onOpenEditor: () => void }) {
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === harnessId))
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const updateHarness = useProjectStore((s) => s.updateHarness)
  const { lib } = useEffectiveLibrary()

  if (!harness) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Harness not found.</div>
  }
  const eps = harness.endpoints.map((ep) => resolveEndpoint(lib, instances, ep))
  const label = (end: string) => eps[end.charCodeAt(0) - 97]?.instance.label ?? end.toUpperCase()

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <label className="ww-label" htmlFor="ww-lm-harness-name">
            Name
          </label>
          <input
            id="ww-lm-harness-name"
            className="ww-input"
            value={harness.name}
            onChange={(e) => updateHarness(harnessId, { name: e.target.value })}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {eps.map((re, i) => (
            <div key={i} className="rounded border border-edge bg-panelalt p-3">
              <div className="text-[11px] uppercase text-muted">End {endLabel(i).toUpperCase()}</div>
              <div className="text-xs font-medium">{re ? re.instance.label : 'unresolved'}</div>
              <div className="text-xs text-muted">{re?.port.name ?? '—'}</div>
              <div className="mt-1 text-[11px] text-muted">Connector: {re?.connector?.name ?? 'none'}</div>
            </div>
          ))}
        </div>
        <div className="rounded border border-edge bg-panelalt p-3">
          <div className="mb-1 text-[11px] uppercase text-muted">
            Wiring · {harness.wires.length} wire{harness.wires.length === 1 ? '' : 's'}
          </div>
          {harness.wires.length === 0 && <div className="text-[11px] text-muted">No wires yet.</div>}
          {harness.wires.map((w) => (
            <div key={w.id} className="text-[11px] text-muted">
              {label(w.from.end)} pin {w.from.position} → {label(w.to.end)} pin {w.to.position}
              {w.label ? ` · ${w.label}` : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
        <button className="ww-btn-primary" onClick={onOpenEditor}>
          <Pencil size={14} /> Open harness editor
        </button>
      </div>
    </div>
  )
}
