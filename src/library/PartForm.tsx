/**
 * The one part form, used by both the part-editor modal and the Library
 * Manager's detail pane. Pure presentation over a draft: callers own saving.
 */
import { useMemo } from 'react'
import { nanoid } from 'nanoid'
import { ExternalLink, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { CURRENCIES } from '../model/currency'
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
import { fileToDataUrl, imageUrl, makeThumbDataUrl } from '../shared/useImage'
import { toast } from '../shared/toast'

const PART_TYPES: PartType[] = ['COTS', 'MOTS', 'Custom']
const SIDES: PortSide[] = ['left', 'right', 'top', 'bottom']
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp,image/gif'

export function blankPart(kind: Exclude<PartKind, 'subassembly'>): Part {
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

/** A reason the draft cannot be saved, or null when it is valid. */
export function validatePart(draft: Part): string | null {
  if (!draft.name.trim()) return 'Give the part a name.'
  if (draft.kind === 'connector' && !(draft.positions >= 1)) return 'A connector needs at least one position.'
  for (const url of [draft.manufacturerPartUrl, draft.supplierPartUrl]) {
    if (url && !isWebUrl(url)) return `"${url}" is not a web link (it must start with http:// or https://).`
  }
  return null
}

function isWebUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const numOrUndef = (v: string): number | undefined => (v === '' ? undefined : Number(v))

export function PartForm({
  draft,
  onChange,
  templates,
  connectors,
  onNewTemplate
}: {
  draft: Part
  onChange: (next: Part) => void
  templates: { id: string; name: string }[]
  connectors: { id: string; name: string }[]
  onNewTemplate: () => void
}) {
  const patch = (p: Partial<Part>) => onChange({ ...draft, ...p } as Part)

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file)
      // Thumbnail rendered client-side at import; cards and canvas nodes only
      // ever decode this small WebP.
      const thumb = await makeThumbDataUrl(dataUrl)
      const res = await window.ww.image.import(dataUrl, thumb)
      patch({ imageHash: res.hash })
    } catch (err) {
      toast(`Image not added: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)}`, 'error')
    }
  }

  const img = imageUrl(draft.imageHash, 'thumb')

  return (
    <div>
      <div className="grid grid-cols-[160px_1fr] gap-4">
        <div>
          <span className="ww-label">Image</span>
          <label
            className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-edge bg-panelalt hover:border-accent focus-within:border-accent"
            onDrop={(e) => {
              e.preventDefault()
              void onPickImage(e.dataTransfer.files[0])
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            {img ? (
              <img src={img} className="h-full w-full object-contain" alt={`${draft.name || 'Part'} image`} />
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted">
                <ImagePlus size={22} aria-hidden />
                <span className="text-[11px]">Drop or click</span>
                <span className="text-[11px]">PNG, JPEG, WebP</span>
              </div>
            )}
            <input
              type="file"
              accept={ACCEPTED_IMAGES}
              className="sr-only"
              aria-label="Choose part image"
              onChange={(e) => void onPickImage(e.target.files?.[0])}
            />
          </label>
          {draft.imageHash && (
            <button
              className="mt-1 flex items-center gap-1 text-[11px] text-muted hover:text-ink"
              onClick={() => patch({ imageHash: undefined })}
            >
              <Trash2 size={12} /> Remove image
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" span2>
            {(id) => (
              <input id={id} className="ww-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <select id={id} className="ww-input" value={draft.type} onChange={(e) => patch({ type: e.target.value as PartType })}>
                {PART_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Internal part number">
            {(id) => (
              <input id={id} className="ww-input" value={draft.internalPartNumber} onChange={(e) => patch({ internalPartNumber: e.target.value })} />
            )}
          </Field>
          <Field label="Manufacturer">
            {(id) => (
              <input id={id} className="ww-input" value={draft.manufacturer} onChange={(e) => patch({ manufacturer: e.target.value })} />
            )}
          </Field>
          <LinkedField
            label="Manufacturer PN"
            value={draft.manufacturerPartNumber}
            url={draft.manufacturerPartUrl}
            onValue={(v) => patch({ manufacturerPartNumber: v })}
            onUrl={(v) => patch({ manufacturerPartUrl: v || undefined })}
          />
          <Field label="Supplier">
            {(id) => (
              <input id={id} className="ww-input" value={draft.supplier} onChange={(e) => patch({ supplier: e.target.value })} />
            )}
          </Field>
          <LinkedField
            label="Supplier PN"
            value={draft.supplierPartNumber}
            url={draft.supplierPartUrl}
            onValue={(v) => patch({ supplierPartNumber: v })}
            onUrl={(v) => patch({ supplierPartUrl: v || undefined })}
          />
          <Field label="Unit cost">
            {(id) => (
              <div className="flex gap-1">
                <input
                  id={id}
                  type="number"
                  min={0}
                  step="0.01"
                  className="ww-input"
                  placeholder="0.00"
                  value={draft.cost?.amount ?? ''}
                  onChange={(e) => {
                    const amount = numOrUndef(e.target.value)
                    patch({
                      cost: amount == null ? undefined : { amount, currency: draft.cost?.currency ?? 'USD' }
                    })
                  }}
                />
                <select
                  className="ww-input w-24"
                  aria-label="Currency"
                  value={draft.cost?.currency ?? 'USD'}
                  onChange={(e) => patch({ cost: { amount: draft.cost?.amount ?? 0, currency: e.target.value } })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>
          <Field label="Weight (g)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="ww-input"
                value={draft.weightGrams ?? ''}
                onChange={(e) => patch({ weightGrams: numOrUndef(e.target.value) })}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        {draft.kind === 'connector' && (
          <ConnectorFields part={draft} patch={(p) => patch(p)} connectors={connectors} />
        )}
        {draft.kind === 'wire' && <WireFields part={draft} patch={(p) => patch(p)} />}
        {draft.kind === 'device' && (
          <PortEditor device={draft} patch={(p) => patch(p)} templates={templates} onNewTemplate={onNewTemplate} />
        )}
      </div>
    </div>
  )
}

let fieldSeq = 0

/** A labelled form field; the child receives the id to put on its control. */
export function Field({
  label,
  children,
  span2
}: {
  label: string
  children: (id: string) => React.ReactNode
  span2?: boolean
}) {
  const id = useMemo(() => `ww-field-${++fieldSeq}`, [])
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="ww-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  )
}

function LinkedField({
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
  const id = useMemo(() => `ww-field-${++fieldSeq}`, [])
  const bad = !!url && !isWebUrl(url)
  return (
    <div>
      <label className="ww-label flex items-center gap-1" htmlFor={id}>
        {label}
        {url && !bad && (
          <button
            type="button"
            className="text-accent hover:brightness-125"
            onClick={() => void window.ww.openExternal(url)}
            title={`Open ${url}`}
            aria-label={`Open ${label} link`}
          >
            <ExternalLink size={12} />
          </button>
        )}
      </label>
      <input id={id} className="ww-input" value={value} onChange={(e) => onValue(e.target.value)} />
      <input
        className={`ww-input mt-1 text-[11px] ${bad ? 'border-danger' : ''}`}
        placeholder="https://… (product page)"
        aria-label={`${label} link`}
        aria-invalid={bad}
        value={url ?? ''}
        onChange={(e) => onUrl(e.target.value)}
      />
      {bad && <div className="mt-0.5 text-[11px] text-danger">Must start with http:// or https://</div>}
    </div>
  )
}

function ConnectorFields({
  part,
  patch,
  connectors
}: {
  part: ConnectorPart
  patch: (p: Partial<ConnectorPart>) => void
  connectors: { id: string; name: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Positions (pins)">
        {(id) => (
          <input
            id={id}
            type="number"
            min={1}
            className="ww-input"
            value={part.positions}
            onChange={(e) => patch({ positions: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
        )}
      </Field>
      <Field label="Gender">
        {(id) => (
          <select
            id={id}
            className="ww-input"
            value={part.gender ?? ''}
            onChange={(e) => patch({ gender: (e.target.value || undefined) as ConnectorPart['gender'] })}
          >
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="hermaphroditic">Hermaphroditic</option>
          </select>
        )}
      </Field>
      <Field label="Mating connector" span2>
        {(id) => (
          <select
            id={id}
            className="ww-input"
            value={part.matingConnectorPartId ?? ''}
            onChange={(e) => patch({ matingConnectorPartId: e.target.value || undefined })}
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
        )}
      </Field>
    </div>
  )
}

function WireFields({ part, patch }: { part: WirePart; patch: (p: Partial<WirePart>) => void }) {
  const text = (label: string, key: keyof WirePart, placeholder: string) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className="ww-input"
          placeholder={placeholder}
          value={(part[key] as string | undefined) ?? ''}
          onChange={(e) => patch({ [key]: e.target.value || undefined } as Partial<WirePart>)}
        />
      )}
    </Field>
  )
  return (
    <div className="grid grid-cols-3 gap-3">
      {text('Gauge', 'gauge', '28 AWG')}
      {text('Colour', 'color', 'red or #ff0000')}
      <Field label="Conductors">
        {(id) => (
          <input
            id={id}
            type="number"
            min={1}
            className="ww-input"
            value={part.conductors ?? 1}
            onChange={(e) => patch({ conductors: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
        )}
      </Field>
      {text('UL style', 'ulStyle', '2464')}
      {text('Jacket material', 'jacketMaterial', 'PVC')}
      {text('Voltage rating', 'voltageRating', '300 V')}
      <Field label="Outer diameter (mm)">
        {(id) => (
          <input
            id={id}
            type="number"
            min={0}
            step={0.1}
            className="ww-input"
            placeholder="3.5"
            value={part.outerDiameterMm ?? ''}
            onChange={(e) => patch({ outerDiameterMm: numOrUndef(e.target.value) })}
          />
        )}
      </Field>
      {text('Operating temperature', 'operatingTemperature', '-25 ~ 80 °C')}
      {text('Insulator colour', 'insulatorColor', 'white + black')}
      <Field label="Cable style">
        {(id) => (
          <select id={id} className="ww-input" value={part.cableStyle ?? ''} onChange={(e) => patch({ cableStyle: e.target.value || undefined })}>
            <option value="">—</option>
            <option value="round">Round</option>
            <option value="flat">Flat</option>
          </select>
        )}
      </Field>
      <Field label="Category">
        {(id) => (
          <select
            id={id}
            className="ww-input"
            value={part.category ?? ''}
            onChange={(e) => patch({ category: (e.target.value || undefined) as WirePart['category'] })}
          >
            <option value="">—</option>
            <option value="cable">Single wire</option>
            <option value="bundle">Bundle</option>
          </select>
        )}
      </Field>
      <div className="flex items-end">
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <input
            type="checkbox"
            className="accent-accent"
            checked={part.shield ?? false}
            onChange={(e) => patch({ shield: e.target.checked })}
          />
          Shielded
        </label>
      </div>
    </div>
  )
}

function PortEditor({
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
      { id: nanoid(), name: `Port ${device.ports.length + 1}`, pinoutTemplateId: templates[0]?.id ?? '', side: 'right' }
    ])
  const updatePort = (id: string, p: Partial<DevicePort>) =>
    setPorts(device.ports.map((port) => (port.id === id ? { ...port, ...p } : port)))
  const removePort = (id: string) => setPorts(device.ports.filter((port) => port.id !== id))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="ww-label mb-0">Ports</span>
        <div className="flex gap-1">
          <button className="ww-btn" onClick={onNewTemplate}>
            <Plus size={13} /> New pinout template
          </button>
          <button className="ww-btn" onClick={addPort}>
            <Plus size={13} /> Add port
          </button>
        </div>
      </div>
      {device.ports.length === 0 && (
        <div className="rounded border border-dashed border-edge px-3 py-4 text-center text-[11px] text-muted">
          No ports yet. A device needs ports (each using a pinout template) before it can be wired.
        </div>
      )}
      <div className="space-y-2">
        {device.ports.map((port, i) => (
          <div
            key={port.id}
            className="grid grid-cols-[1fr_1.4fr_auto_auto] items-end gap-2 rounded border border-edge bg-panelalt p-2"
          >
            <Field label="Name">
              {(id) => (
                <input id={id} className="ww-input" value={port.name} onChange={(e) => updatePort(port.id, { name: e.target.value })} />
              )}
            </Field>
            <Field label="Pinout template">
              {(id) => (
                <select
                  id={id}
                  className={`ww-input ${port.pinoutTemplateId ? '' : 'border-warn'}`}
                  value={port.pinoutTemplateId}
                  onChange={(e) => updatePort(port.id, { pinoutTemplateId: e.target.value })}
                >
                  <option value="">— select —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Side">
              {(id) => (
                <select
                  id={id}
                  className="ww-input w-24"
                  value={port.side}
                  onChange={(e) => updatePort(port.id, { side: e.target.value as PortSide })}
                >
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              className="ww-btn mb-0.5 px-2"
              onClick={() => removePort(port.id)}
              title="Remove port"
              aria-label={`Remove port ${i + 1} (${port.name})`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
