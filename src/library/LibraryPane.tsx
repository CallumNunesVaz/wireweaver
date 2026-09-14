import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  Search,
  Plus,
  Cpu,
  ListTree,
  ChevronRight,
  ChevronDown,
  Pencil,
  Copy,
  Trash2,
  Cable,
  Plug,
  Boxes
} from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore, type LibraryCategory } from '../stores/uiStore'
import { findPartReferences, findTemplateReferences } from '../model/references'
import { fuzzySearch } from './FuzzySearch'
import type { Part, PartKind, SubassemblyPart } from '../model/types'
import { imageUrl } from '../shared/useImage'
import { ContextMenu, type CtxItem } from '../shared/ContextMenu'
import { instantiateSubassemblyHarness } from '../model/subassembly'
import { toast } from '../shared/toast'

const CATEGORY_META: {
  key: LibraryCategory
  label: string
  icon: typeof Cpu
  canCreate: boolean
}[] = [
  { key: 'device', label: 'Devices', icon: Cpu, canCreate: true },
  { key: 'connector', label: 'Connectors', icon: Plug, canCreate: true },
  { key: 'wire', label: 'Wires', icon: Cable, canCreate: true },
  { key: 'subassembly', label: 'Subassemblies', icon: Boxes, canCreate: false },
  { key: 'pinout', label: 'Pinout Templates', icon: ListTree, canCreate: true }
]

type FilterPill = 'all' | PartKind

const FILTER_PILLS: { key: FilterPill; label: string; icon: typeof Cpu }[] = [
  { key: 'all', label: 'All', icon: Cpu },
  { key: 'device', label: 'Devices', icon: Cpu },
  { key: 'connector', label: 'Connectors', icon: Plug },
  { key: 'wire', label: 'Wires', icon: Cable },
  { key: 'subassembly', label: 'Subassemblies', icon: Boxes }
]

export function LibraryPane() {
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const search = useUiStore((s) => s.librarySearch)
  const setSearch = useUiStore((s) => s.setLibrarySearch)
  const openPartEditor = useUiStore((s) => s.openPartEditor)
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeFilter, setActiveFilter] = useState<FilterPill>('all')

  const filteredParts = useMemo(() => {
    let result = fuzzySearch(parts, search)
    if (activeFilter !== 'all') {
      result = result.filter((p) => p.kind === activeFilter)
    }
    return result
  }, [parts, search, activeFilter])

  const templateMatches = useMemo(
    () => templates.filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase())),
    [templates, search]
  )

  const grouped = useMemo(() => {
    const by: Record<PartKind, Part[]> = { device: [], connector: [], wire: [], subassembly: [] }
    for (const p of filteredParts) {
      by[p.kind].push(p)
    }
    return by
  }, [filteredParts])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="border-b border-edge p-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="ww-library-search"
            className="ww-input pl-7"
            placeholder="Search library… (Ctrl+F)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 border-b border-edge px-2 py-1.5">
        {FILTER_PILLS.map(({ key, label }) => (
          <button
            key={key}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              activeFilter === key
                ? 'bg-accent text-white'
                : 'bg-panelalt text-muted hover:text-ink'
            }`}
            onClick={() => setActiveFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {CATEGORY_META.map(({ key, label, icon: Icon, canCreate }) => {
          const isOpen = !collapsed[key]
          const items = key === 'pinout' ? templateMatches : grouped[key as PartKind]
          return (
            <section key={key} className="border-b border-edge/60">
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                  className="flex flex-1 items-center gap-1.5 text-left text-muted hover:text-ink"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [key]: !c[key] }))
                  }
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Icon size={14} />
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {label}
                  </span>
                  <span className="text-[10px] text-muted">({items.length})</span>
                </button>
                {canCreate && (
                  <button
                    className="rounded p-0.5 text-muted hover:bg-edge hover:text-ink"
                    title={`New ${label.replace(/s$/, '')}`}
                    onClick={() =>
                      key === 'pinout'
                        ? openTemplateEditor(null)
                        : openPartEditor({ kind: key as PartKind })
                    }
                  >
                    <Plus size={15} />
                  </button>
                )}
              </div>

              {isOpen && items.length > 0 && (
                <Virtuoso
                  style={{ height: Math.min(items.length * 88, 400) }}
                  totalCount={items.length}
                  itemContent={(index) => {
                    const item = items[index]
                    if (key === 'pinout' && 'connectorPartId' in item) {
                      const t = item as typeof templates[0]
                      return <TemplateCardListItem id={t.id} name={t.name} />
                    }
                    if ('kind' in item) {
                      if ((item as Part).kind === 'subassembly') {
                        return <SubassemblyCardListItem part={item as SubassemblyPart} />
                      }
                      return <PartCardListItem part={item as Part} />
                    }
                    return null
                  }}
                />
              )}
              {isOpen && items.length === 0 && (
                <div className="px-1 py-2 text-[11px] text-muted">None yet.</div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

function PartCardListItem({ part }: { part: Part }) {
  const img = imageUrl(part.imageHash, 'thumb')
  const openPartEditor = useUiStore((s) => s.openPartEditor)
  const removePart = useLibraryStore((s) => s.removePart)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const draggable = part.kind === 'device'

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/ww-part', part.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const menuItems: CtxItem[] = useMemo(() => {
    if (!menu) return []
    const lib = useLibraryStore.getState()
    const project = useProjectStore.getState().project
    const refs = findPartReferences(part.id, lib.parts, lib.templates, project)
    return [
      {
        label: 'Edit',
        icon: <Pencil size={14} />,
        onClick: () => openPartEditor({ kind: part.kind, partId: part.id })
      },
      {
        label: 'Duplicate',
        icon: <Copy size={14} />,
        onClick: () =>
          upsertPart({ ...part, id: nanoid(), name: `${part.name} copy`, createdAt: Date.now(), updatedAt: Date.now() })
      },
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: refs.length > 0,
        note: refs.length > 0 ? `In use by: ${refs.join(', ')}` : undefined,
        onClick: () => removePart(part.id)
      }
    ]
  }, [menu, part, openPartEditor, upsertPart, removePart])

  return (
    <>
      <div
        className="group flex cursor-grab items-center gap-2 rounded border border-edge bg-panelalt
          px-2 py-1.5 hover:border-accent active:cursor-grabbing"
        draggable={draggable}
        onDragStart={draggable ? onDragStart : undefined}
        onDoubleClick={() => openPartEditor({ kind: part.kind, partId: part.id })}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={draggable ? 'Drag onto the canvas to place' : 'Double-click to edit'}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
          {img ? (
            <img src={img} className="h-full w-full object-cover" alt="" />
          ) : (
            <span className="text-[10px] text-muted">{part.type}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{part.name}</div>
          <div className="truncate text-[10px] text-muted">
            {part.internalPartNumber || part.manufacturerPartNumber || '—'}
          </div>
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

function SubassemblyCardListItem({ part }: { part: SubassemblyPart }) {
  const removePart = useLibraryStore((s) => s.removePart)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const wires = part.harness?.wires?.length ?? 0
  const ends = part.harness?.endpoints?.length ?? 0

  const insert = () => {
    const lib = selectLibraryLike(useLibraryStore.getState())
    const instances = useProjectStore.getState().project.deviceInstances
    const { harness, matched, missing } = instantiateSubassemblyHarness(lib, instances, part)
    if (!harness) {
      toast('Cannot insert: no placed devices match its ports.', 'error')
      return
    }
    const id = useProjectStore.getState().importHarness(harness)
    useUiStore.getState().select({ type: 'harness', id })
    toast(
      `Inserted "${part.name}" — ${matched} endpoint(s)${
        missing ? `, ${missing} unmatched` : ''
      }.`,
      'success'
    )
  }

  const menuItems: CtxItem[] = [
    { label: 'Insert into project', icon: <Plus size={14} />, onClick: insert },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => removePart(part.id)
    }
  ]

  return (
    <>
      <div
        className="flex cursor-pointer items-center gap-2 rounded border border-edge bg-panelalt
          px-2 py-1.5 hover:border-accent"
        onClick={insert}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title="Click to insert this subassembly's harness into the project"
      >
        <Boxes size={14} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{part.name}</div>
          <div className="truncate text-[10px] text-muted">
            {ends} ends · {wires} wires
          </div>
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

function TemplateCardListItem({ id, name }: { id: string; name: string }) {
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)
  const removeTemplate = useLibraryStore((s) => s.removeTemplate)
  const template = useLibraryStore((s) => s.templates.find((t) => t.id === id))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/ww-template', id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const menuItems: CtxItem[] = useMemo(() => {
    if (!menu) return []
    const refs = findTemplateReferences(id, useLibraryStore.getState().parts)
    return [
      {
        label: 'Edit',
        icon: <Pencil size={14} />,
        onClick: () => openTemplateEditor(id)
      },
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: refs.length > 0,
        note: refs.length > 0 ? `Used by: ${refs.join(', ')}` : undefined,
        onClick: () => removeTemplate(id)
      }
    ]
  }, [menu, id, openTemplateEditor, removeTemplate])

  return (
    <>
      <div
        className="flex cursor-grab items-center gap-2 rounded border border-edge bg-panelalt
          px-2 py-1.5 hover:border-accent active:cursor-grabbing"
        draggable
        onDragStart={onDragStart}
        onDoubleClick={() => openTemplateEditor(id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title="Drag onto a device to add as a port · Double-click to edit"
      >
        <ListTree size={14} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{name}</div>
          <div className="truncate text-[10px] text-muted">
            {template ? `${template.pins.length} pins` : ''}
          </div>
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}
