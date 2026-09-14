import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { ImagePlus, Trash2, Plus, ExternalLink } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { useLibraryStore } from '../stores/libraryStore'
import { useUiStore } from '../stores/uiStore'
import { CURRENCIES } from '../model/currency'
import { fileToDataUrl, imageUrl, makeThumbDataUrl } from '../shared/useImage'
import type {
  ConnectorPart,
  DevicePart,
  DevicePort,
  Part,
  PartKind,
  PartType,
  PortSide,
  WirePart
} from '../model/types'
import { isConnector } from '../model/types'

const PART_TYPES: PartType[] = ['COTS', 'MOTS', 'Custom']
const SIDES: PortSide[] = ['left', 'right', 'top', 'bottom']

function blankPart(kind: PartKind): Part {
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
  if (kind === 'device') return { ...base, kind: 'device', ports: [] }
  if (kind === 'connector') return { ...base, kind: 'connector', positions: 2 }
  return { ...base, kind: 'wire' }
}

export function PartEditor() {
  const target = useUiStore((s) => s.partEditor)!
  const close = useUiStore((s) => s.closePartEditor)
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const existing = useLibraryStore((s) =>
    target.partId ? s.parts.find((p) => p.id === target.partId) : undefined
  )
  const templates = useLibraryStore((s) => s.templates)
  const connectors = useLibraryStore((s) =>
    s.parts.filter(isConnector).map((c) => ({ id: c.id, name: c.name }))
  )

  const [draft, setDraft] = useState<Part>(
    () => (existing ? structuredClone(existing) : blankPart(target.kind))
  )

  const patch = (p: Partial<Part>) => setDraft((d) => ({ ...d, ...p }) as Part)
  const img = imageUrl(draft.imageHash, 'full')

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    // Thumbnail rendered client-side at import; library cards and canvas nodes
    // only ever decode this small WebP.
    const thumb = await makeThumbDataUrl(dataUrl)
    const res = await window.ww.image.import(dataUrl, thumb)
    patch({ imageHash: res.hash })
  }

  const save = () => {
    if (!draft.name.trim()) {
      toast('Please give the part a name.', 'error')
      return
    }
    upsertPart(draft)
    close()
  }

  const title = `${existing ? 'Edit' : 'New'} ${draft.kind}`

  return (
    <Modal
      title={title}
      onClose={close}
      wide
      footer={
        <>
          <button className="ww-btn" onClick={close}>
            Cancel
          </button>
          <button className="ww-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[160px_1fr] gap-4">
        {/* Image */}
        <div>
          <label className="ww-label">Image</label>
          <label
            className="flex aspect-square cursor-pointer items-center justify-center
              overflow-hidden rounded border border-dashed border-edge bg-panelalt hover:border-accent"
            onDrop={(e) => {
              e.preventDefault()
              onPickImage(e.dataTransfer.files[0])
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            {img ? (
              <img src={img} className="h-full w-full object-cover" alt="" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted">
                <ImagePlus size={22} />
                <span className="text-[10px]">Drop / click</span>
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
          </label>
          {draft.imageHash && (
            <button
              className="mt-1 flex items-center gap-1 text-[11px] text-muted hover:text-ink"
              onClick={() => patch({ imageHash: undefined })}
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>

        {/* Shared fields */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" span2>
            <input
              className="ww-input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="Type">
            <select
              className="ww-input"
              value={draft.type}
              onChange={(e) => patch({ type: e.target.value as PartType })}
            >
              {PART_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Internal Part Number">
            <input
              className="ww-input"
              value={draft.internalPartNumber}
              onChange={(e) => patch({ internalPartNumber: e.target.value })}
            />
          </Field>

          <Field label="Manufacturer">
            <input
              className="ww-input"
              value={draft.manufacturer}
              onChange={(e) => patch({ manufacturer: e.target.value })}
            />
          </Field>
          <LinkedField
            label="Manufacturer PN"
            value={draft.manufacturerPartNumber}
            url={draft.manufacturerPartUrl}
            onValue={(v) => patch({ manufacturerPartNumber: v })}
            onUrl={(v) => patch({ manufacturerPartUrl: v })}
          />

          <Field label="Supplier">
            <input
              className="ww-input"
              value={draft.supplier}
              onChange={(e) => patch({ supplier: e.target.value })}
            />
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
                onChange={(e) =>
                  patch({
                    cost: e.target.value
                      ? {
                          amount: Number(e.target.value),
                          currency: draft.cost?.currency ?? 'USD'
                        }
                      : undefined
                  })
                }
              />
              <select
                className="ww-input w-24"
                value={draft.cost?.currency ?? 'USD'}
                onChange={(e) =>
                  patch({
                    cost: {
                      amount: draft.cost?.amount ?? 0,
                      currency: e.target.value
                    }
                  })
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Weight (g)">
            <input
              type="number"
              className="ww-input"
              value={draft.weightGrams ?? ''}
              onChange={(e) =>
                patch({
                  weightGrams: e.target.value ? Number(e.target.value) : undefined
                })
              }
            />
          </Field>
        </div>
      </div>

      {/* Kind-specific */}
      <div className="mt-4 border-t border-edge pt-4">
        {draft.kind === 'connector' && (
          <ConnectorFields
            part={draft as ConnectorPart}
            patch={patch as (p: Partial<ConnectorPart>) => void}
            connectors={connectors}
          />
        )}
        {draft.kind === 'wire' && (
          <WireFields
            part={draft as WirePart}
            patch={patch as (p: Partial<WirePart>) => void}
          />
        )}
        {draft.kind === 'device' && (
          <PortEditor
            device={draft as DevicePart}
            patch={patch as (p: Partial<DevicePart>) => void}
            templates={templates}
            onNewTemplate={() => openTemplateEditor(null)}
          />
        )}
      </div>
    </Modal>
  )
}

export function Field({
  label,
  children,
  span2
}: {
  label: string
  children: React.ReactNode
  span2?: boolean
}) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="ww-label">{label}</label>
      {children}
    </div>
  )
}

export function LinkedField({
  label,
  value,
  url,
  onValue,
  onUrl
}: {
  label: string
  value: string
  url?: string
  onValue: (v: string) => void
  onUrl: (v: string) => void
}) {
  return (
    <div>
      <label className="ww-label flex items-center gap-1">
        {label}
        {url && (
          <button
            className="text-accent hover:brightness-125"
            onClick={() => window.ww.openExternal(url)}
            title={url}
          >
            <ExternalLink size={12} />
          </button>
        )}
      </label>
      <input
        className="ww-input"
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
      <input
        className="ww-input mt-1 text-[11px]"
        placeholder="https://… (hyperlink)"
        value={url ?? ''}
        onChange={(e) => onUrl(e.target.value)}
      />
    </div>
  )
}

export function ConnectorFields({
  part,
  patch,
  connectors
}: {
  part: ConnectorPart
  patch: (p: Partial<ConnectorPart>) => void
  connectors?: { id: string; name: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Positions (pins)">
        <input
          type="number"
          min={1}
          className="ww-input"
          value={part.positions}
          onChange={(e) => patch({ positions: Math.max(1, Number(e.target.value)) })}
        />
      </Field>
      <Field label="Gender">
        <select
          className="ww-input"
          value={part.gender ?? ''}
          onChange={(e) =>
            patch({ gender: (e.target.value || undefined) as ConnectorPart['gender'] })
          }
        >
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="hermaphroditic">Hermaphroditic</option>
        </select>
      </Field>
      {connectors && connectors.length > 0 && (
        <Field label="Mating Connector" span2>
          <select
            className="ww-input"
            value={part.matingConnectorPartId ?? ''}
            onChange={(e) =>
              patch({ matingConnectorPartId: e.target.value || undefined })
            }
          >
            <option value="">— none —</option>
            {connectors
              .filter((c) => c.id !== part.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      )}
    </div>
  )
}

export function WireFields({
  part,
  patch
}: {
  part: WirePart
  patch: (p: Partial<WirePart>) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Gauge">
        <input
          className="ww-input"
          placeholder="28 AWG"
          value={part.gauge ?? ''}
          onChange={(e) => patch({ gauge: e.target.value })}
        />
      </Field>
      <Field label="Colour">
        <input
          className="ww-input"
          placeholder="red"
          value={part.color ?? ''}
          onChange={(e) => patch({ color: e.target.value })}
        />
      </Field>
      <Field label="Conductors">
        <input
          type="number"
          min={1}
          className="ww-input"
          value={part.conductors ?? 1}
          onChange={(e) => patch({ conductors: Number(e.target.value) })}
        />
      </Field>
      <Field label="UL Style">
        <input
          className="ww-input"
          placeholder="2464"
          value={part.ulStyle ?? ''}
          onChange={(e) => patch({ ulStyle: e.target.value })}
        />
      </Field>
      <Field label="Jacket Material">
        <input
          className="ww-input"
          placeholder="PVC"
          value={part.jacketMaterial ?? ''}
          onChange={(e) => patch({ jacketMaterial: e.target.value })}
        />
      </Field>
      <Field label="Voltage Rating">
        <input
          className="ww-input"
          placeholder="300 V"
          value={part.voltageRating ?? ''}
          onChange={(e) => patch({ voltageRating: e.target.value })}
        />
      </Field>
      <Field label="Outer Diameter (mm)">
        <input
          type="number"
          min={0}
          step={0.1}
          className="ww-input"
          placeholder="3.5"
          value={part.outerDiameterMm ?? ''}
          onChange={(e) => patch({ outerDiameterMm: e.target.value ? Number(e.target.value) : undefined })}
        />
      </Field>
      <Field label="Operating Temp.">
        <input
          className="ww-input"
          placeholder="-25 ~ 80 °C"
          value={part.operatingTemperature ?? ''}
          onChange={(e) => patch({ operatingTemperature: e.target.value })}
        />
      </Field>
      <Field label="Insulator Colour">
        <input
          className="ww-input"
          placeholder="white + black"
          value={part.insulatorColor ?? ''}
          onChange={(e) => patch({ insulatorColor: e.target.value })}
        />
      </Field>
      <Field label="Cable Style">
        <select
          className="ww-input"
          value={part.cableStyle ?? ''}
          onChange={(e) => patch({ cableStyle: e.target.value || undefined })}
        >
          <option value="">—</option>
          <option value="round">Round</option>
          <option value="flat">Flat</option>
        </select>
      </Field>
      <Field label="Shield">
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            className="accent-accent"
            checked={part.shield ?? false}
            onChange={(e) => patch({ shield: e.target.checked })}
          />
          <span className="text-xs">Shielded</span>
        </div>
      </Field>
      <Field label="Category">
        <select
          className="ww-input"
          value={part.category ?? ''}
          onChange={(e) => patch({ category: (e.target.value || undefined) as WirePart['category'] })}
        >
          <option value="">—</option>
          <option value="cable">Single wire</option>
          <option value="bundle">Bundle</option>
        </select>
      </Field>
    </div>
  )
}

export function PortEditor({
  device,
  patch,
  templates,
  onNewTemplate
}: {
  device: DevicePart
  patch: (p: Partial<DevicePart>) => void
  templates: { id: string; name: string }[]
  onNewTemplate: () => void
}) {
  const setPorts = (ports: DevicePort[]) => patch({ ports })
  const addPort = () =>
    setPorts([
      ...device.ports,
      {
        id: nanoid(),
        name: `Port ${device.ports.length + 1}`,
        pinoutTemplateId: templates[0]?.id ?? '',
        side: 'right'
      }
    ])
  const updatePort = (id: string, p: Partial<DevicePort>) =>
    setPorts(device.ports.map((port) => (port.id === id ? { ...port, ...p } : port)))
  const removePort = (id: string) =>
    setPorts(device.ports.filter((port) => port.id !== id))

  const templateOptions = useMemo(() => templates, [templates])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="ww-label mb-0">Ports</label>
        <div className="flex gap-1">
          <button className="ww-btn" onClick={onNewTemplate}>
            <Plus size={13} /> New template
          </button>
          <button className="ww-btn" onClick={addPort}>
            <Plus size={13} /> Add port
          </button>
        </div>
      </div>
      {device.ports.length === 0 && (
        <div className="rounded border border-dashed border-edge px-3 py-4 text-center text-[11px] text-muted">
          No ports. A device needs ports (each using a pinout template) to be wired.
        </div>
      )}
      <div className="space-y-2">
        {device.ports.map((port) => (
          <div
            key={port.id}
            className="grid grid-cols-[1fr_1.4fr_auto_auto] items-end gap-2 rounded border border-edge bg-panelalt p-2"
          >
            <div>
              <label className="ww-label">Name</label>
              <input
                className="ww-input"
                value={port.name}
                onChange={(e) => updatePort(port.id, { name: e.target.value })}
              />
            </div>
            <div>
              <label className="ww-label">Pinout template</label>
              <select
                className="ww-input"
                value={port.pinoutTemplateId}
                onChange={(e) =>
                  updatePort(port.id, { pinoutTemplateId: e.target.value })
                }
              >
                <option value="">— select —</option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ww-label">Side</label>
              <select
                className="ww-input w-20"
                value={port.side}
                onChange={(e) =>
                  updatePort(port.id, { side: e.target.value as PortSide })
                }
              >
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="ww-btn mb-0.5 px-2"
              onClick={() => removePort(port.id)}
              title="Remove port"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
