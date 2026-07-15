import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  Plus,
  Cpu,
  Plug,
  Cable,
  ListTree,
  ChevronRight,
  ChevronDown,
  Download,
  Upload,
  BookOpen,
  X,
  Pencil,
  Trash2,
  Copy,
  Filter,
  RotateCcw
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useLibraryStore } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { findPartReferences, findTemplateReferences } from '../model/references'
import { toast } from '../shared/toast'
import { imageUrl, fileToDataUrl, makeThumbDataUrl } from '../shared/useImage'
import { CURRENCIES } from '../model/currency'
import { ContextMenu } from '../shared/ContextMenu'
import type { Part, PartKind, PartType, PinoutTemplate, HarnessEndpoint, WirePart } from '../model/types'
import { isDevice, isConnector, isWire, endIndex } from '../model/types'

// Reuse shared form fields from PartEditor
import {
  Field,
  LinkedField,
  ConnectorFields,
  WireFields,
  PortEditor
} from './PartEditor'

type LibraryItem =
  | { kind: 'part'; id: string }
  | { kind: 'template'; id: string }
  | { kind: 'harness'; id: string }

type Selection = LibraryItem | null

const PART_TYPES: PartType[] = ['COTS', 'MOTS', 'Custom']

export function LibraryManager() {
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const removePart = useLibraryStore((s) => s.removePart)
  const upsertTemplate = useLibraryStore((s) => s.upsertTemplate)
  const removeTemplate = useLibraryStore((s) => s.removeTemplate)
  const openHarnessEditor = useUiStore((s) => s.openHarnessEditor)
  const toggleLibraryManager = useUiStore((s) => s.toggleLibraryManager)

  const projectHarnesses = useProjectStore((s) => s.project.harnesses)
  const instances = useProjectStore((s) => s.project.deviceInstances)

  const [selection, setSelection] = useState<Selection>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<Record<string, boolean>>({
    device: true,
    connector: true,
    wire: true,
    template: true,
    harness: true
  })
  const [wireFilters, setWireFilters] = useState<Record<string, string>>({})
  const [showWireFilters, setShowWireFilters] = useState(false)
  const [showSelect, setShowSelect] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; selection: LibraryItem } | null>(null)
  const [editorDraft, setEditorDraft] = useState<Part | null>(null)
  const [templateDraft, setTemplateDraft] = useState<PinoutTemplate | null>(null)

  const q = search.trim().toLowerCase()
  const matches = (text: string) => !q || text.toLowerCase().includes(q)

  // Filter parts
  const filteredParts = useMemo(() => {
    return parts.filter((p) => {
      if (!matches(`${p.name} ${p.internalPartNumber} ${p.manufacturerPartNumber}`)) return false
      return true
    })
  }, [parts, q])

  const devices = filteredParts.filter(isDevice)
  const connectors = filteredParts.filter(isConnector)

  const wireFilterOptions = useMemo(() => {
    const allWires = parts.filter(isWire)
    const distinct = (extract: (w: WirePart) => string | number | boolean | undefined): string[] => {
      const vals = new Set<string>()
      for (const w of allWires) {
        const v = extract(w)
        if (v != null && v !== '') vals.add(String(v))
      }
      return [...vals].sort()
    }
    return {
      gauge: distinct((w) => w.gauge),
      conductors: distinct((w) => w.conductors),
      ulStyle: distinct((w) => w.ulStyle),
      jacketMaterial: distinct((w) => w.jacketMaterial),
      voltageRating: distinct((w) => w.voltageRating),
      outerDiameterMm: distinct((w) => w.outerDiameterMm),
      operatingTemperature: distinct((w) => w.operatingTemperature),
      color: distinct((w) => w.color),
      insulatorColor: distinct((w) => w.insulatorColor),
      cableStyle: distinct((w) => w.cableStyle),
      shield: distinct((w) => (w.shield != null ? String(w.shield) : '')),
      colorCode: distinct((w) => w.colorCode),
      category: distinct((w) => w.category)
    }
  }, [parts])

  const wires = useMemo(() => {
    let result = filteredParts.filter(isWire)
    for (const [key, value] of Object.entries(wireFilters)) {
      if (!value) continue
      result = result.filter((w) => {
        const v = (w as Record<string, unknown>)[key]
        if (key === 'shield') {
          return String(!!v) === value
        }
        if (value === '__none__') return v == null || v === ''
        return String(v ?? '') === value
      })
    }
    return result
  }, [filteredParts, wireFilters])

  // Filter templates
  const filteredTemplates = useMemo(
    () => templates.filter((t) => matches(t.name)),
    [templates, q]
  )

  // Filter harnesses
  const filteredHarnesses = useMemo(
    () => projectHarnesses.filter((h) => matches(h.name)),
    [projectHarnesses, q]
  )

  // Build section visibility
  const sections = [
    { key: 'device', label: 'Devices', icon: Cpu, items: devices, filterKey: 'device' as const },
    { key: 'connector', label: 'Connectors', icon: Plug, items: connectors, filterKey: 'connector' as const },
    { key: 'wire', label: 'Wires', icon: Cable, items: wires, filterKey: 'wire' as const },
    { key: 'template', label: 'Templates', icon: ListTree, items: filteredTemplates, filterKey: 'template' as const },
    { key: 'harness', label: 'Harnesses', icon: Cable, items: filteredHarnesses, filterKey: 'harness' as const }
  ]

  // Select item handler
  const select = useCallback((sel: Selection) => {
    setSelection(sel)
    setEditorDraft(null)
    setTemplateDraft(null)
  }, [])

  // When a part/template is selected, load it into the editor draft.
  const selectedPartId = selection?.kind === 'part' ? selection.id : undefined
  const selectedTemplateId = selection?.kind === 'template' ? selection.id : undefined

  useEffect(() => {
    if (!selectedPartId) return
    const part = parts.find((p) => p.id === selectedPartId)
    if (part) setEditorDraft(structuredClone(part))
  }, [selectedPartId, parts])

  useEffect(() => {
    if (!selectedTemplateId) return
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (tpl) setTemplateDraft(structuredClone(tpl))
  }, [selectedTemplateId, templates])

  // Toggle checkbox
  const toggleCheck = (id: string) => {
    setChecked((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Bulk delete
  const bulkDelete = () => {
    const names: string[] = []
    for (const id of checked) {
      const p = parts.find((x) => x.id === id)
      const t = templates.find((x) => x.id === id)
      if (p) names.push(p.name)
      else if (t) names.push(t.name)
    }
    if (names.length === 0) return
    if (!window.confirm(`Delete ${names.length} item(s)?\n\n${names.slice(0, 10).join('\n')}${names.length > 10 ? `\n... and ${names.length - 10} more` : ''}`)) return
    for (const id of checked) {
      const p = parts.find((x) => x.id === id)
      if (p) removePart(id)
      else {
        const t = templates.find((x) => x.id === id)
        if (t) removeTemplate(id)
      }
    }
    setChecked(new Set())
    setShowSelect(false)
    if (selection && checked.has(selection.id)) setSelection(null)
  }

  // Import / Export
  const handleExport = useCallback(async () => {
    const res = await window.ww.library.export({ parts, templates })
    if (!res.canceled && res.path) toast(`Library exported to ${res.path}`, 'success')
  }, [parts, templates])

  const handleImport = useCallback(async () => {
    const res = await window.ww.library.import()
    if (res.canceled || !res.data) return
    const importedParts = Array.isArray(res.data.parts) ? res.data.parts : []
    const importedTemplates = Array.isArray(res.data.templates) ? res.data.templates : []
    if (importedParts.length === 0 && importedTemplates.length === 0) {
      toast('Not a WireWeaver library file (no parts or templates found).', 'error')
      return
    }
    const lib = useLibraryStore.getState()
    let addedParts = 0
    let addedTemplates = 0
    for (const t of importedTemplates) {
      if (!t || typeof t.id !== 'string') continue
      if (!lib.templates.find((x) => x.id === t.id)) {
        lib.upsertTemplate(t)
        addedTemplates++
      }
    }
    for (const p of importedParts) {
      if (!p || typeof p.id !== 'string') continue
      if (!lib.parts.find((x) => x.id === p.id)) {
        lib.upsertPart(p)
        addedParts++
      }
    }
    toast(`Imported ${addedParts} part(s) and ${addedTemplates} template(s).`, 'success')
  }, [])

  // Save edited part
  const savePart = () => {
    if (!editorDraft) return
    if (!editorDraft.name.trim()) {
      window.alert('Please give the part a name.')
      return
    }
    upsertPart(editorDraft)
    setEditorDraft(null)
    setSelection(null)
  }

  const saveTemplate = () => {
    if (!templateDraft) return
    if (!templateDraft.name.trim()) {
      window.alert('Please name the template.')
      return
    }
    upsertTemplate(templateDraft)
    setTemplateDraft(null)
    setSelection(null)
  }

  // Close keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleLibraryManager()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleLibraryManager])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-panel">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <BookOpen size={18} className="text-accent" />
        <span className="text-sm font-semibold">Library Manager</span>
        <span className="text-[11px] text-muted ml-2">
          {parts.length} parts · {templates.length} templates · {projectHarnesses.length} harnesses
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button className="ww-btn" onClick={handleImport} title="Import library (.wwlib)">
            <Upload size={14} /> Import
          </button>
          <button className="ww-btn" onClick={handleExport} title="Export library (.wwlib)">
            <Download size={14} /> Export
          </button>
          <button
            className="ww-btn"
            onClick={() => { setShowSelect(!showSelect); setChecked(new Set()) }}
            title={showSelect ? 'Cancel selection' : 'Select items'}
          >
            {showSelect ? 'Cancel' : 'Select'}
          </button>
          {showSelect && checked.size > 0 && (
            <button className="ww-btn text-[#e5484d]" onClick={bulkDelete}>
              <Trash2 size={14} /> Delete {checked.size}
            </button>
          )}
          <button className="ww-btn ml-2" onClick={toggleLibraryManager} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1 border-b border-edge px-3 py-1.5 flex-wrap">
        {[
          { key: 'device', label: 'Devices' },
          { key: 'connector', label: 'Connectors' },
          { key: 'wire', label: 'Wires' },
          { key: 'template', label: 'Templates' },
          { key: 'harness', label: 'Harnesses' }
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              filters[key] ? 'bg-accent text-white' : 'bg-panelalt text-muted hover:text-ink'
            }`}
            onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-64 shrink-0 flex-col border-r border-edge">
          <div className="border-b border-edge p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="ww-input pl-7"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {filters.wire && (
            <div className="border-b border-edge px-2 py-1">
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] transition-colors flex items-center gap-1 w-full ${
                  showWireFilters ? 'bg-accent text-white' : 'bg-panelalt text-muted hover:text-ink'
                }`}
                onClick={(e) => { e.preventDefault(); setShowWireFilters(!showWireFilters) }}
              >
                <Filter size={11} /> Filters{Object.values(wireFilters).filter(Boolean).length > 0 ? ` (${Object.values(wireFilters).filter(Boolean).length})` : ''}
              </button>
              {showWireFilters && (
                <div className="mt-1">
                  <WireFilterBar
                    options={wireFilterOptions}
                    filters={wireFilters}
                    setFilters={setWireFilters}
                  />
                </div>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sections.map(({ key, label, icon: Icon, items, filterKey }) => {
              if (!filters[filterKey]) return null
              const isOpen = !collapsed[key]
              return (
                <section key={key} className="border-b border-edge/60">
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <button
                      className="flex flex-1 items-center gap-1.5 text-left text-muted hover:text-ink"
                      onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Icon size={14} />
                      <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                      <span className="text-[10px] text-muted">({items.length})</span>
                    </button>
                    {(key === 'device' || key === 'connector' || key === 'wire') && (
                      <button
                        className="rounded p-0.5 text-muted hover:bg-edge hover:text-ink"
                        title={`New ${label.replace(/s$/, '')}`}
                        onClick={() => {
                          const kind = key as PartKind
                          const base = {
                            id: nanoid(),
                            name: '',
                            type: 'COTS' as PartType,
                            internalPartNumber: '',
                            manufacturer: '',
                            manufacturerPartNumber: '',
                            supplier: '',
                            supplierPartNumber: ''
                          }
                          let blank: Part
                          if (kind === 'device') blank = { ...base, kind: 'device' as const, ports: [] } as Part
                          else if (kind === 'connector') blank = { ...base, kind: 'connector' as const, positions: 2 } as Part
                          else blank = { ...base, kind: 'wire' as const } as Part
                          upsertPart(blank)
                          setSelection({ kind: 'part', id: blank.id })
                        }}
                      >
                        <Plus size={15} />
                      </button>
                    )}
                    {key === 'template' && (
                      <button
                        className="rounded p-0.5 text-muted hover:bg-edge hover:text-ink"
                        title="New template"
                        onClick={() => {
                          const tpl: PinoutTemplate = { id: nanoid(), name: '', connectorPartId: '', pins: [] }
                          upsertTemplate(tpl)
                          setSelection({ kind: 'template', id: tpl.id })
                        }}
                      >
                        <Plus size={15} />
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="space-y-0.5 px-2 pb-2">
                      {items.length === 0 && (
                        <div className="px-1 py-2 text-[11px] text-muted">None.</div>
                      )}
                      {items.map((item) => {
                        const itemId = 'id' in item ? item.id : ''
                        const isSelected = selection?.id === itemId
                        const isChecked = checked.has(itemId)
                        let title = ''
                        let subtitle = ''
                        let thumb: string | null = null
                        let itemKind: LibraryItem['kind']

                        if ('kind' in item && (isDevice(item) || isConnector(item) || isWire(item))) {
                          title = item.name || '(unnamed)'
                          subtitle = item.internalPartNumber || item.manufacturerPartNumber || item.type
                          thumb = imageUrl(item.imageHash, 'thumb')
                          itemKind = 'part'
                        } else if ('connectorPartId' in item) {
                          const t = item as PinoutTemplate
                          title = t.name || '(unnamed)'
                          subtitle = `${t.pins.length} pins`
                          itemKind = 'template'
                        } else {
                          const h = item as { id: string; name: string; wires: unknown[] }
                          title = h.name || '(unnamed)'
                          subtitle = `${(h.wires as unknown[])?.length ?? 0} wires`
                          itemKind = 'harness'
                        }

                        const onContext = (e: React.MouseEvent) => {
                          e.preventDefault()
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            selection: { kind: itemKind, id: itemId }
                          })
                        }

                        return (
                          <div
                            key={itemId}
                            className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left text-xs hover:border-accent ${
                              isSelected ? 'border-accent bg-panelalt' : 'border-edge bg-panelalt'
                            }`}
                            onClick={() => {
                              if (showSelect) {
                                toggleCheck(itemId)
                              } else {
                                select({ kind: itemKind, id: itemId })
                              }
                            }}
                            onContextMenu={onContext}
                          >
                            {showSelect && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCheck(itemId)}
                                className="h-3.5 w-3.5 accent-accent"
                                onClick={(e) => e.stopPropagation()}
                              />
                            )}
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
                              {thumb ? (
                                <img src={thumb} className="h-full w-full object-cover" alt="" />
                              ) : itemKind === 'harness' ? (
                                <Cable size={12} className="text-muted" />
                              ) : itemKind === 'template' ? (
                                <ListTree size={12} className="text-muted" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{title}</div>
                              <div className="truncate text-[10px] text-muted">{subtitle}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>

        {/* Detail pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selection ? (
            <div className="flex h-full items-center justify-center text-muted">
              <div className="text-center">
                <BookOpen size={28} className="mx-auto mb-2" />
                <div className="text-sm">Select an item from the sidebar</div>
              </div>
            </div>
          ) : selection.kind === 'harness' ? (
            <HarnessInfoCard
              harnessId={selection.id}
              onOpenEditor={() => openHarnessEditor(selection.id)}
              instances={instances}
              parts={parts}
              templates={templates}
            />
          ) : selection.kind === 'template' ? (
            <TemplateDetail
              draft={templateDraft}
              setDraft={setTemplateDraft}
              onSave={saveTemplate}
              onDelete={() => {
                const refs = findTemplateReferences(selection.id, parts)
                if (refs.length > 0 && !window.confirm(`This template is used by: ${refs.join(', ')}.\nDelete anyway?`)) return
                removeTemplate(selection.id)
                setSelection(null)
              }}
              connectors={connectors}
            />
          ) : (
            <PartDetail
              draft={editorDraft}
              setDraft={setEditorDraft}
              onSave={savePart}
              onDelete={() => {
                if (!editorDraft) return
                const proj = useProjectStore.getState().project
                const refs = findPartReferences(editorDraft.id, parts, templates, proj)
                if (refs.length > 0 && !window.confirm(`This part is used by: ${refs.join(', ')}.\nDelete anyway?`)) return
                removePart(editorDraft.id)
                setSelection(null)
              }}
              onDuplicate={() => {
                if (!editorDraft) return
                const copy = { ...editorDraft, id: nanoid(), name: `${editorDraft.name} copy`, createdAt: Date.now(), updatedAt: Date.now() }
                upsertPart(copy)
                setSelection({ kind: 'part', id: copy.id })
              }}
              templates={templates}
            />
          )}
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={(() => {
            if (menu.selection.kind === 'harness') {
              return [
                { label: 'Open Harness Editor', icon: <Pencil size={14} />, onClick: () => openHarnessEditor(menu.selection.id) }
              ]
            }
            if (menu.selection.kind === 'template') {
              return [
                { label: 'Edit', icon: <Pencil size={14} />, onClick: () => setSelection(menu.selection) },
                {
                  label: 'Delete',
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onClick: () => {
                    const refs = findTemplateReferences(menu.selection.id, parts)
                    if (refs.length > 0 && !window.confirm(`Used by: ${refs.join(', ')}.\nDelete anyway?`)) return
                    removeTemplate(menu.selection.id)
                    setSelection(null)
                  }
                }
              ]
            }
            const partId = menu.selection.id
            return [
              { label: 'Edit', icon: <Pencil size={14} />, onClick: () => setSelection(menu.selection) },
              {
                label: 'Duplicate',
                icon: <Copy size={14} />,
                onClick: () => {
                  const p = parts.find((x) => x.id === partId)
                  if (p) {
                    const copy = { ...p, id: nanoid(), name: `${p.name} copy`, createdAt: Date.now(), updatedAt: Date.now() }
                    upsertPart(copy)
                    setSelection({ kind: 'part', id: copy.id })
                  }
                }
              },
              {
                label: 'Delete',
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: () => {
                  const p = parts.find((x) => x.id === partId)
                  if (!p) return
                  const proj = useProjectStore.getState().project
                  const refs = findPartReferences(p.id, parts, templates, proj)
                  if (refs.length > 0 && !window.confirm(`Used by: ${refs.join(', ')}.\nDelete anyway?`)) return
                  removePart(p.id)
                  setSelection(null)
                }
              }
            ]
          })()}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function PartDetail({
  draft,
  setDraft,
  onSave,
  onDelete,
  onDuplicate,
  templates
}: {
  draft: Part | null
  setDraft: (d: Part) => void
  onSave: () => void
  onDelete: () => void
  onDuplicate: () => void
  templates: { id: string; name: string }[]
}) {
  if (!draft) return null
  const patch = (p: Partial<Part>) => setDraft({ ...draft, ...p } as Part)

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    // Thumbnail rendered client-side at import, same as PartEditor — cards
    // and canvas nodes only ever decode the small WebP.
    const thumb = await makeThumbDataUrl(dataUrl)
    const res = await window.ww.image.import(dataUrl, thumb)
    patch({ imageHash: res.hash })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[140px_1fr] gap-4">
          <div>
            <label className="ww-label">Image</label>
            <label
              className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-edge bg-panelalt hover:border-accent"
              onDrop={(e) => {
                e.preventDefault()
                onPickImage(e.dataTransfer.files[0])
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {draft.imageHash ? (
                <img src={imageUrl(draft.imageHash, 'thumb') ?? undefined} className="h-full w-full object-cover" alt="" />
              ) : (
                <span className="text-[10px] text-muted">Drop image</span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickImage(e.target.files?.[0])}
              />
            </label>
            {draft.imageHash && (
              <button className="mt-1 text-[11px] text-muted hover:text-ink" onClick={() => patch({ imageHash: undefined })}>
                <Trash2 size={12} className="inline mr-0.5" /> Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" span2>
              <input className="ww-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
            </Field>
            <Field label="Type">
              <select className="ww-input" value={draft.type} onChange={(e) => patch({ type: e.target.value as PartType })}>
                {PART_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Internal Part Number">
              <input className="ww-input" value={draft.internalPartNumber} onChange={(e) => patch({ internalPartNumber: e.target.value })} />
            </Field>
            <Field label="Manufacturer">
              <input className="ww-input" value={draft.manufacturer} onChange={(e) => patch({ manufacturer: e.target.value })} />
            </Field>
            <LinkedField
              label="Manufacturer PN"
              value={draft.manufacturerPartNumber}
              url={draft.manufacturerPartUrl}
              onValue={(v) => patch({ manufacturerPartNumber: v })}
              onUrl={(v) => patch({ manufacturerPartUrl: v })}
            />
            <Field label="Supplier">
              <input className="ww-input" value={draft.supplier} onChange={(e) => patch({ supplier: e.target.value })} />
            </Field>
            <LinkedField
              label="Supplier PN"
              value={draft.supplierPartNumber}
              url={draft.supplierPartUrl}
              onValue={(v) => patch({ supplierPartNumber: v })}
              onUrl={(v) => patch({ supplierPartUrl: v })}
            />
            <Field label="Cost">
              <div className="flex gap-1">
                <input
                  type="number"
                  className="ww-input"
                  placeholder="0.00"
                  value={draft.cost?.amount ?? ''}
                  onChange={(e) => patch({ cost: e.target.value ? { amount: Number(e.target.value), currency: draft.cost?.currency ?? 'USD' } : undefined })}
                />
                <select
                  className="ww-input w-24"
                  value={draft.cost?.currency ?? 'USD'}
                  onChange={(e) => patch({ cost: { amount: draft.cost?.amount ?? 0, currency: e.target.value } })}
                >
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </div>
            </Field>
            <Field label="Weight (g)">
              <input type="number" className="ww-input" value={draft.weightGrams ?? ''} onChange={(e) => patch({ weightGrams: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          </div>
        </div>

        <div className="mt-4 border-t border-edge pt-4">
          {draft.kind === 'connector' && <ConnectorFields part={draft as import('../model/types').ConnectorPart} patch={patch as (p: Partial<import('../model/types').ConnectorPart>) => void} />}
          {draft.kind === 'wire' && <WireFields part={draft as import('../model/types').WirePart} patch={patch as (p: Partial<import('../model/types').WirePart>) => void} />}
          {draft.kind === 'device' && (
            <PortEditor
              device={draft as import('../model/types').DevicePart}
              patch={patch as (p: Partial<import('../model/types').DevicePart>) => void}
              templates={templates}
              onNewTemplate={() => {
                useUiStore.getState().openTemplateEditor(null)
              }}
            />
          )}
        </div>

        {/* Usage */}
        <UsagePanel draft={draft} />
      </div>

      <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
        <button className="ww-btn" onClick={onDelete} title="Delete"><Trash2 size={14} /> Delete</button>
        <button className="ww-btn" onClick={onDuplicate} title="Duplicate"><Copy size={14} /> Duplicate</button>
        <div className="flex-1" />
        <button className="ww-btn-primary" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

function UsagePanel({ draft }: { draft: Part | null }) {
  if (!draft) return null
  const parts = useLibraryStore.getState().parts
  const templates = useLibraryStore.getState().templates
  const project = useProjectStore.getState().project

  const refs = findPartReferences(draft.id, parts, templates, project)
  if (refs.length === 0) {
    return (
      <div className="mt-3 text-[11px] text-muted border-t border-edge pt-3">
        Not used in the current project.
    </div>
  )
  }

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <div className="ww-label">Usage</div>
      <div className="space-y-1">
        {refs.map((r, i) => (
          <div key={i} className="text-[11px] text-muted">{r}</div>
        ))}
      </div>
    </div>
  )
}

const WIRE_FILTER_FIELDS: { key: string; label: string }[] = [
  { key: 'gauge', label: 'AWG' },
  { key: 'conductors', label: '# Conductors' },
  { key: 'ulStyle', label: 'UL Style' },
  { key: 'jacketMaterial', label: 'Jacket' },
  { key: 'voltageRating', label: 'Voltage' },
  { key: 'outerDiameterMm', label: 'OD (mm)' },
  { key: 'operatingTemperature', label: 'Temp.' },
  { key: 'color', label: 'Color' },
  { key: 'insulatorColor', label: 'Ins. Color' },
  { key: 'cableStyle', label: 'Cable Style' },
  { key: 'shield', label: 'Shield' },
  { key: 'colorCode', label: 'Color Code' },
  { key: 'category', label: 'Category' }
]

function WireFilterBar({
  options,
  filters,
  setFilters
}: {
  options: Record<string, string[]>
  filters: Record<string, string>
  setFilters: (f: Record<string, string>) => void
}) {
  const activeCount = Object.values(filters).filter(Boolean).length
  const hasFilterOptions = Object.keys(options).some((k) => options[k]?.length > 0)

  if (!hasFilterOptions) {
    return <span className="text-[11px] text-muted">No wire properties to filter on.</span>
  }

  return (
    <div className="space-y-1">
      {activeCount > 0 && (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] bg-panelalt text-muted hover:text-ink flex items-center gap-1"
          onClick={() => setFilters({})}
        >
          <RotateCcw size={11} /> Clear
        </button>
      )}
      <div className="grid grid-cols-2 gap-1">
        {WIRE_FILTER_FIELDS.map(({ key, label }) => {
          const values = options[key]
          if (!values || values.length <= 1) return null
          return (
            <select
              key={key}
              className="ww-input h-6 text-[10px] py-0 w-full"
              value={filters[key] ?? ''}
              onChange={(e) =>
                setFilters({ ...filters, [key]: e.target.value })
              }
              title={label}
            >
              <option value="">{label}</option>
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
  )
}

function TemplateDetail({
  draft,
  setDraft,
  onSave,
  onDelete,
  connectors
}: {
  draft: PinoutTemplate | null
  setDraft: (d: PinoutTemplate) => void
  onSave: () => void
  onDelete: () => void
  connectors: Part[]
}) {
  // Hooks must run unconditionally — keep them above the null guard.
  const parts = useLibraryStore((s) => s.parts)
  if (!draft) return null
  const refs = findTemplateReferences(draft.id, parts)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ww-label">Name</label>
            <input className="ww-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          </div>
          <div>
            <label className="ww-label">Connector part</label>
            <select className="ww-input" value={draft.connectorPartId} onChange={(e) => setDraft({ ...draft, connectorPartId: e.target.value })}>
              <option value="">— select —</option>
              {connectors.map((c) => <option key={c.id} value={c.id}>{c.name} ({(c as import('../model/types').ConnectorPart).positions}-pos)</option>)}
            </select>
          </div>
        </div>

        {connectors.find((c) => c.id === draft.connectorPartId) && (
          <div className="space-y-1">
            <label className="ww-label">Pins</label>
            {draft.pins.map((pin) => (
              <div key={pin.position} className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-panelalt text-[10px] font-semibold">{pin.position}</span>
                <input className="ww-input flex-1" value={pin.signal} placeholder={`Signal ${pin.position}`} onChange={(e) => setDraft({ ...draft, pins: draft.pins.map((p) => p.position === pin.position ? { ...p, signal: e.target.value } : p) })} />
              </div>
            ))}
          </div>
        )}

        {refs.length > 0 && (
          <div className="border-t border-edge pt-3">
            <div className="ww-label">Used by</div>
            {refs.map((r, i) => (
              <div key={i} className="text-[11px] text-muted">{r}</div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
        <button className="ww-btn" onClick={onDelete} title="Delete"><Trash2 size={14} /> Delete</button>
        <div className="flex-1" />
        <button className="ww-btn-primary" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

function HarnessInfoCard({
  harnessId,
  onOpenEditor,
  instances,
  parts,
  templates
}: {
  harnessId: string
  onOpenEditor: () => void
  instances: { id: string; label: string; partId: string }[]
  parts: Part[]
  templates: PinoutTemplate[]
}) {
  const harness = useProjectStore((s) => s.project.harnesses.find((h) => h.id === harnessId))
  const updateHarness = useProjectStore((s) => s.updateHarness)

  if (!harness) {
    return <div className="flex h-full items-center justify-center text-muted text-sm">Harness not found.</div>
  }

  const endpointInfo = (end: HarnessEndpoint) => {
    const inst = instances.find((i) => i.id === end.deviceInstanceId)
    const dev = inst ? parts.find((p) => p.id === inst.partId) : undefined
    const port = dev && isDevice(dev) ? dev.ports.find((p) => p.id === end.portId) : undefined
    const tpl = port ? templates.find((t) => t.id === port.pinoutTemplateId) : undefined
    return {
      instanceLabel: inst?.label ?? '??',
      portName: port?.name ?? '??',
      connectorName: tpl
        ? (parts.find((p) => p.id === tpl.connectorPartId) as { name?: string } | undefined)?.name ?? 'no connector'
        : 'no connector'
    }
  }

  const eps = harness.endpoints.map(endpointInfo)
  const wiredCount = harness.wires.length

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="ww-label">Name</label>
          <input className="ww-input" value={harness.name} onChange={(e) => updateHarness(harnessId, { name: e.target.value })} />
        </div>

        <div className="grid gap-3">
          {eps.map((ep, i) => (
            <div key={i} className="rounded border border-edge bg-panelalt p-3">
              <div className="text-[10px] uppercase text-muted mb-1">End {String.fromCharCode(65 + i)}</div>
              <div className="text-xs font-medium">{ep.instanceLabel}</div>
              <div className="text-xs text-muted">{ep.portName}</div>
              <div className="text-[10px] text-muted mt-1">Connector: {ep.connectorName}</div>
            </div>
        ))}
      </div>

        {harness.segments.length > 0 && (
          <div className="rounded border border-edge bg-panelalt p-3">
            <div className="text-[10px] uppercase text-muted mb-1">Segments</div>
            {harness.segments.map((seg, i) => (
              <div key={i} className="text-xs">
                <span className="text-muted">{seg.fromEnd.toUpperCase()} → {seg.toEnd.toUpperCase()}</span>
                {seg.lengthMm != null && <span className="ml-2">{seg.lengthMm} mm</span>}
                {seg.label && <span className="ml-2 text-muted">{seg.label}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="rounded border border-edge bg-panelalt p-3">
          <div className="text-[10px] uppercase text-muted mb-1">Wiring</div>
          <div className="text-xs">{wiredCount} wire{wiredCount === 1 ? '' : 's'}</div>
          {harness.wires.map((w) => {
            const fromEp = eps[endIndex(w.from.end)]
            const toEp = eps[endIndex(w.to.end)]
            return (
              <div key={w.id} className="text-[11px] text-muted mt-1">
                {fromEp?.instanceLabel} pin {w.from.position} → {toEp?.instanceLabel} pin {w.to.position}
              </div>
            )
          })}
          {wiredCount === 0 && <div className="text-[11px] text-muted">No wires defined.</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
        <button className="ww-btn-primary" onClick={onOpenEditor}>
          <Pencil size={14} /> Open Harness Editor
        </button>
      </div>
    </div>
  )
}
