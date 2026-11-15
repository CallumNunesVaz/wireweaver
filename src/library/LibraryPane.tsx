import { useMemo, useState } from 'react'
import {
  Boxes,
  Cable,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  ListTree,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { useLibraryStore } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore, type LibraryCategory } from '../stores/uiStore'
import { getEffectiveLibrary } from '../stores/effectiveLibrary'
import { fuzzySearch } from './FuzzySearch'
import type { Part, PartKind, PinoutTemplate, SubassemblyPart } from '../model/types'
import { imageUrl } from '../shared/useImage'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { instantiateSubassemblyHarness } from '../model/subassembly'
import { toast } from '../shared/toast'
import { deletePart, deleteTemplate, duplicatePart } from './libraryActions'

const CATEGORY_META: {
  key: LibraryCategory
  label: string
  singular: string
  icon: typeof Cpu
  canCreate: boolean
}[] = [
  { key: 'device', label: 'Devices', singular: 'device', icon: Cpu, canCreate: true },
  { key: 'connector', label: 'Connectors', singular: 'connector', icon: Plug, canCreate: true },
  { key: 'wire', label: 'Wires', singular: 'wire', icon: Cable, canCreate: true },
  { key: 'subassembly', label: 'Subassemblies', singular: 'subassembly', icon: Boxes, canCreate: false },
  { key: 'pinout', label: 'Pinout templates', singular: 'pinout template', icon: ListTree, canCreate: true }
]

type FilterPill = 'all' | LibraryCategory

const FILTER_PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'device', label: 'Devices' },
  { key: 'connector', label: 'Connectors' },
  { key: 'wire', label: 'Wires' },
  { key: 'subassembly', label: 'Subassemblies' },
  { key: 'pinout', label: 'Templates' }
]

type Row =
  | { type: 'header'; key: LibraryCategory; count: number; open: boolean }
  | { type: 'part'; part: Part }
  | { type: 'sub'; part: SubassemblyPart }
  | { type: 'template'; template: PinoutTemplate }
  | { type: 'empty'; key: LibraryCategory; searching: boolean }

const EMPTY_HINT: Record<LibraryCategory, string> = {
  device: 'No devices yet. Use + to create one, then drag it onto the canvas.',
  connector: 'No connectors yet.',
  wire: 'No wires yet.',
  subassembly: 'Save a harness as a subassembly from the Inspector to reuse it.',
  pinout: 'No pinout templates yet.'
}

export function LibraryPane() {
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const search = useUiStore((s) => s.librarySearch)
  const setSearch = useUiStore((s) => s.setLibrarySearch)
  const openPartEditor = useUiStore((s) => s.openPartEditor)
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeFilter, setActiveFilter] = useState<FilterPill>('all')
  const q = search.trim()

  const rows = useMemo<Row[]>(() => {
    const matched = fuzzySearch(parts, search)
    const by: Record<PartKind, Part[]> = { device: [], connector: [], wire: [], subassembly: [] }
    for (const p of matched) by[p.kind]?.push(p)
    const tpls = q ? templates.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : templates

    const out: Row[] = []
    for (const { key } of CATEGORY_META) {
      if (activeFilter !== 'all' && activeFilter !== key) continue
      const items = key === 'pinout' ? tpls : by[key as PartKind]
      const open = !collapsed[key] || !!q
      out.push({ type: 'header', key, count: items.length, open })
      if (!open) continue
      if (items.length === 0) {
        out.push({ type: 'empty', key, searching: !!q })
        continue
      }
      for (const it of items) {
        if (key === 'pinout') out.push({ type: 'template', template: it as PinoutTemplate })
        else if (key === 'subassembly') out.push({ type: 'sub', part: it as SubassemblyPart })
        else out.push({ type: 'part', part: it as Part })
      }
    }
    return out
  }, [parts, templates, search, q, activeFilter, collapsed])

  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r border-edge bg-panel"
      aria-label="Library"
      data-testid="library-sidebar"
    >
      <div className="border-b border-edge p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="ww-library-search"
            className="ww-input pl-7"
            placeholder="Search library… (Ctrl+F)"
            aria-label="Search library"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.stopPropagation()
                setSearch('')
              }
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Show">
          {FILTER_PILLS.map(({ key, label }) => (
            <button
              key={key}
              role="radio"
              aria-checked={activeFilter === key}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                activeFilter === key ? 'bg-accent text-accent-ink' : 'bg-panelalt text-muted hover:text-ink'
              }`}
              onClick={() => setActiveFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Virtuoso
          style={{ height: '100%' }}
          data={rows}
          computeItemKey={(_, r) =>
            r.type === 'header' || r.type === 'empty'
              ? `${r.type}-${r.key}`
              : r.type === 'template'
                ? r.template.id
                : r.part.id
          }
          itemContent={(_, row) => {
            if (row.type === 'header') {
              const meta = CATEGORY_META.find((m) => m.key === row.key)!
              const Icon = meta.icon
              return (
                <div className="flex items-center gap-1 border-t border-edge/60 px-2 pb-1 pt-2 first:border-t-0">
                  <button
                    className="flex flex-1 items-center gap-1.5 text-left text-muted hover:text-ink"
                    aria-expanded={row.open}
                    onClick={() => setCollapsed((c) => ({ ...c, [row.key]: !c[row.key] }))}
                  >
                    {row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Icon size={14} aria-hidden />
                    <span className="text-[11px] font-medium uppercase tracking-wide">{meta.label}</span>
                    <span className="text-[11px]">({row.count})</span>
                  </button>
                  {meta.canCreate && (
                    <button
                      className="ww-icon-btn"
                      title={`New ${meta.singular}`}
                      aria-label={`New ${meta.singular}`}
                      onClick={() =>
                        row.key === 'pinout'
                          ? openTemplateEditor(null)
                          : openPartEditor({ kind: row.key as PartKind })
                      }
                    >
                      <Plus size={15} />
                    </button>
                  )}
                </div>
              )
            }
            if (row.type === 'empty') {
              return (
                <div className="px-3 pb-2 text-[11px] text-muted">
                  {row.searching ? 'No matches.' : EMPTY_HINT[row.key]}
                </div>
              )
            }
            return (
              <div className="px-2 py-0.5">
                {row.type === 'template' ? (
                  <TemplateCard template={row.template} />
                ) : row.type === 'sub' ? (
                  <SubassemblyCard part={row.part} />
                ) : (
                  <PartCard part={row.part} />
                )}
              </div>
            )
          }}
        />
      </div>
    </aside>
  )
}

function PartCard({ part }: { part: Part }) {
  const img = imageUrl(part.imageHash, 'thumb')
  const openPartEditor = useUiStore((s) => s.openPartEditor)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const draggable = part.kind === 'device'

  const menuItems: CtxItem[] = [
    { label: 'Edit', icon: <Pencil size={14} />, onClick: () => openPartEditor({ kind: part.kind, partId: part.id }) },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => void duplicatePart(part) },
    { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, onClick: () => void deletePart(part) }
  ]

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`flex items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 hover:border-accent ${
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        }`}
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                e.dataTransfer.setData('application/ww-part', part.id)
                e.dataTransfer.effectAllowed = 'copy'
              }
            : undefined
        }
        onDoubleClick={() => openPartEditor({ kind: part.kind, partId: part.id })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openPartEditor({ kind: part.kind, partId: part.id })
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: r.left + 16, y: r.bottom })
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={draggable ? 'Drag onto the canvas to place · Double-click to edit' : 'Double-click to edit'}
        aria-label={`${part.name}${draggable ? ', device' : ''}`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
          {img ? (
            <img src={img} className="h-full w-full object-cover" alt="" />
          ) : (
            <span className="text-[11px] text-muted">{part.type}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{part.name || '(unnamed)'}</div>
          <div className="truncate text-[11px] text-muted">
            {part.internalPartNumber || part.manufacturerPartNumber || '—'}
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  )
}

function insertSubassembly(part: SubassemblyPart): void {
  const { lib } = getEffectiveLibrary()
  const instances = useProjectStore.getState().project.deviceInstances
  const { harness, matched, missing } = instantiateSubassemblyHarness(lib, instances, part)
  if (!harness) {
    toast(`Can't insert "${part.name}": no placed devices match its ports.`, 'error')
    return
  }
  const id = useProjectStore.getState().importHarness(harness)
  useUiStore.getState().select({ type: 'harness', id })
  toast(`Inserted "${part.name}" — ${matched} endpoint(s)${missing ? `, ${missing} unmatched` : ''}.`, 'success')
}

function SubassemblyCard({ part }: { part: SubassemblyPart }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const wires = part.harness?.wires?.length ?? 0
  const ends = part.harness?.endpoints?.length ?? 0

  const menuItems: CtxItem[] = [
    { label: 'Insert into project', icon: <Plus size={14} />, onClick: () => insertSubassembly(part) },
    { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, onClick: () => void deletePart(part) }
  ]

  return (
    <>
      <div
        className="flex items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 hover:border-accent"
        onDoubleClick={() => insertSubassembly(part)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title="Double-click or use Insert to add this subassembly's harness to the project"
      >
        <Boxes size={14} className="shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{part.name}</div>
          <div className="truncate text-[11px] text-muted">
            {ends} ends · {wires} wires
          </div>
        </div>
        <button className="ww-btn px-1.5 py-0.5 text-[11px]" onClick={() => insertSubassembly(part)}>
          Insert
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  )
}

function TemplateCard({ template }: { template: PinoutTemplate }) {
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const menuItems: CtxItem[] = [
    { label: 'Edit', icon: <Pencil size={14} />, onClick: () => openTemplateEditor(template.id) },
    { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteTemplate(template) }
  ]

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-grab items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 hover:border-accent active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/ww-template', template.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDoubleClick={() => openTemplateEditor(template.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openTemplateEditor(template.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title="Drag onto a placed device to add a port · Double-click to edit"
      >
        <ListTree size={14} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{template.name || '(unnamed)'}</div>
          <div className="truncate text-[11px] text-muted">{template.pins.length} pins</div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  )
}
