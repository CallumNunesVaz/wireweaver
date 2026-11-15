/**
 * Side panels and pickers used by the Harness Editor: the docked wire
 * inspector (one wire or many), the wire-part picker, the colour picker and
 * the wire library card.
 */
import { memo, useMemo, useState } from 'react'
import { AlertTriangle, Cable, Link2, Shield, Trash2, Unlink2, X } from 'lucide-react'
import type { HarnessWire, WirePart } from '../model/types'
import {
  COLOR_ABBREV_MAP,
  DIN_COLORS,
  codeColor,
  codeSequence,
  formatGauge,
  renderStripedColor
} from '../model/wire'
import { imageUrl } from '../shared/useImage'
import { useOverlay } from '../shared/overlay'

export const COLOR_NAMES: Record<string, string> = {
  BK: 'Black', WH: 'White', GY: 'Grey', PK: 'Pink',
  RD: 'Red', OG: 'Orange', YE: 'Yellow', GN: 'Green',
  BU: 'Blue', VT: 'Violet', BN: 'Brown', TQ: 'Turquoise',
  LB: 'Light Blue', OL: 'Olive', BG: 'Beige', IV: 'Ivory',
  SL: 'Slate', CU: 'Copper', SN: 'Silver', SR: 'Silver Grey',
  GD: 'Gold', SP: 'Shield'
}

export function isStripedColor(color: string | undefined): boolean {
  return !!color && color.startsWith('repeating-linear-gradient')
}

/** Text search over the fields people actually type when looking for wire. */
export function matchesWireQuery(wp: WirePart, q: string): boolean {
  if (!q) return true
  const hay = [
    wp.name,
    wp.internalPartNumber,
    wp.manufacturerPartNumber,
    wp.gauge,
    wp.colorCode,
    wp.color,
    wp.conductors != null ? `${wp.conductors}c` : ''
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

const wireRef = (w: HarnessWire) =>
  `${w.from.end.toUpperCase()}${w.from.position} → ${w.to.end.toUpperCase()}${w.to.position}`

// ---------- Wire inspector (docked) ----------

export function WireInspector({
  wires,
  wireParts,
  canTwist,
  areTwisted,
  onClose,
  onUpdateOne,
  onApplyPart,
  onApplyColor,
  onToggleTwist,
  onSplice,
  onDelete
}: {
  wires: HarnessWire[]
  wireParts: WirePart[]
  canTwist: boolean
  areTwisted: boolean
  onClose: () => void
  onUpdateOne: (patch: Partial<HarnessWire>) => void
  onApplyPart: (wp: WirePart) => void
  onApplyColor: (color: string | undefined) => void
  onToggleTwist: () => void
  onSplice: () => void
  onDelete: () => void
}) {
  const z = useOverlay(onClose, { kind: 'popup', allowsUndo: true })
  const single = wires.length === 1 ? wires[0] : null
  const partById = useMemo(() => new Map(wireParts.map((p) => [p.id, p])), [wireParts])
  const assigned = single?.wirePartId ? partById.get(single.wirePartId) : undefined
  const isTwisted = !!single?.twistedWith

  return (
    <div
      role="region"
      aria-label={single ? 'Wire properties' : 'Selected wires'}
      className="absolute right-4 top-4 w-72 rounded-lg border border-edge bg-panel p-3 shadow-2xl"
      style={{ zIndex: z }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">
          {single ? `Wire ${wireRef(single)}` : `${wires.length} wires selected`}
        </span>
        <button className="ww-icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      {!single && (
        <div className="mb-3 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-muted">
          {wires.map((w) => (
            <div key={w.id} className="truncate">
              {wireRef(w)}
              {w.label ? ` · ${w.label}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <span className="ww-label">{single ? 'Wire part' : 'Assign wire part to all'}</span>
          {single &&
            (assigned ? (
              <div className="mb-1 flex items-center gap-2 rounded border border-edge bg-panelalt px-2 py-1.5 text-xs">
                <Cable size={12} className="text-accent" />
                <span className="flex-1 truncate">{assigned.name}</span>
                <button
                  className="text-[11px] text-muted hover:text-ink"
                  onClick={() => onUpdateOne({ wirePartId: undefined })}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-warn">
                <AlertTriangle size={12} className="shrink-0" /> No wire part assigned
              </div>
            ))}
          <WirePartPicker wireParts={wireParts} onPick={onApplyPart} />
        </div>

        <div>
          <span className="ww-label">{single ? 'Colour' : 'Set colour for all'}</span>
          <ColorSwatchPicker
            currentColor={single ? single.color : undefined}
            onChange={onApplyColor}
          />
        </div>

        {single && (
          <div>
            <label className="ww-label" htmlFor="ww-wire-label">
              Label
            </label>
            <input
              id="ww-wire-label"
              className="ww-input"
              value={single.label ?? ''}
              placeholder="auto (W1, W2, …)"
              onChange={(e) => onUpdateOne({ label: e.target.value || undefined })}
            />
          </div>
        )}

        {isTwisted && (
          <div className="flex items-center gap-1.5 text-[11px] text-accent">
            <Link2 size={12} /> Twisted pair — select both wires to untwist
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {wires.length === 2 && (
            <button
              className="ww-btn"
              disabled={!canTwist}
              onClick={onToggleTwist}
              title={canTwist ? undefined : 'Only wires on the same endpoint pair can be twisted'}
            >
              {areTwisted ? <Unlink2 size={14} /> : <Link2 size={14} />}
              {areTwisted ? 'Untwist' : 'Twist pair'}
            </button>
          )}
          {wires.length >= 2 && (
            <button className="ww-btn" onClick={onSplice}>
              <Link2 size={14} /> Splice
            </button>
          )}
          <button className="ww-btn ml-auto text-danger" onClick={onDelete}>
            <Trash2 size={14} /> Delete{wires.length > 1 ? ` ${wires.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Wire part picker ----------

const PICKER_LIMIT = 50

/** Searchable picker that stays fast with thousands of wire parts. */
export function WirePartPicker({
  wireParts,
  onPick
}: {
  wireParts: WirePart[]
  onPick: (wp: WirePart) => void
}) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const out: WirePart[] = []
    for (const wp of wireParts) {
      if (matchesWireQuery(wp, q.trim())) out.push(wp)
      if (out.length > PICKER_LIMIT) break
    }
    return out
  }, [wireParts, q])

  return (
    <div>
      <input
        className="ww-input mb-1"
        placeholder={`Search ${wireParts.length} wire parts…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search wire parts"
      />
      <div className="max-h-40 overflow-y-auto rounded border border-edge" role="listbox">
        {matches.slice(0, PICKER_LIMIT).map((wp) => (
          <button
            key={wp.id}
            role="option"
            aria-selected={false}
            className="ww-menu-item"
            onClick={() => onPick(wp)}
          >
            <span className="flex-1 truncate">{wp.name}</span>
            {(wp.conductors ?? 1) > 1 && (
              <span className="rounded bg-accent/15 px-1 text-[11px] text-accent">
                {wp.conductors}×
              </span>
            )}
            {wp.shield && <Shield size={11} className="text-warn" aria-label="shielded" />}
          </button>
        ))}
        {matches.length === 0 && (
          <div className="px-2 py-2 text-[11px] text-muted">No matching wire parts.</div>
        )}
        {matches.length > PICKER_LIMIT && (
          <div className="px-2 py-1 text-[11px] text-muted">Refine the search to see more…</div>
        )}
      </div>
    </div>
  )
}

// ---------- Colour picker ----------

/** The first 10 DIN 47100 colours used as the primary swatch palette. */
const DIN_SWATCHES = DIN_COLORS.slice(0, 10)

/** Common pairs used as striped presets. */
const STRIPED_PRESETS: [string, string][] = [
  ['WH', 'RD'], ['YE', 'GN'], ['BK', 'WH'], ['BN', 'BU'],
  ['RD', 'BK'], ['OG', 'WH'], ['GN', 'YE'], ['BU', 'GN'],
  ['WH', 'GN'], ['GY', 'PK'], ['VT', 'WH'], ['BN', 'YE']
]

/** Readable tick colour on top of an arbitrary swatch. */
function contrastInk(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#000'
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000' : '#fff'
}

export function ColorSwatchPicker({
  currentColor,
  onChange
}: {
  currentColor: string | undefined
  onChange: (color: string | undefined) => void
}) {
  const [customColor, setCustomColor] = useState('#5b9bff')

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted">Solid (DIN 47100)</div>
      <div className="flex flex-wrap gap-1">
        {DIN_SWATCHES.map((abbr) => {
          const hex = COLOR_ABBREV_MAP[abbr]
          const selected = !isStripedColor(currentColor) && currentColor === hex
          return (
            <button
              key={abbr}
              className={`relative h-6 w-6 rounded border-2 ${
                selected ? 'border-accent' : 'border-edge hover:border-accent/50'
              }`}
              style={{ background: hex }}
              title={`${abbr} — ${COLOR_NAMES[abbr] ?? abbr}`}
              aria-label={COLOR_NAMES[abbr] ?? abbr}
              aria-pressed={selected}
              onClick={() => onChange(hex)}
            >
              {selected && (
                <span
                  className="absolute inset-0 flex items-center justify-center text-[11px] font-bold"
                  style={{ color: contrastInk(hex) }}
                >
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="text-[11px] text-muted">Striped</div>
      <div className="flex flex-wrap gap-1">
        {STRIPED_PRESETS.map(([p, s]) => {
          const gradient = renderStripedColor({
            primary: COLOR_ABBREV_MAP[p],
            secondary: COLOR_ABBREV_MAP[s]
          })
          const selected = currentColor === gradient
          const name = `${COLOR_NAMES[p] ?? p} / ${COLOR_NAMES[s] ?? s}`
          return (
            <button
              key={`${p}/${s}`}
              className={`h-6 w-6 rounded border-2 ${
                selected ? 'border-accent' : 'border-edge hover:border-accent/50'
              }`}
              style={{ background: gradient }}
              title={`${p}/${s} — ${name}`}
              aria-label={name}
              aria-pressed={selected}
              onClick={() => onChange(gradient)}
            />
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="color"
            className="h-7 w-10 cursor-pointer rounded border border-edge bg-transparent"
            value={
              currentColor && !isStripedColor(currentColor) && currentColor.startsWith('#')
                ? currentColor
                : customColor
            }
            onChange={(e) => {
              setCustomColor(e.target.value)
              onChange(e.target.value)
            }}
          />
          Custom
        </label>
        <button className="ww-btn ml-auto text-[11px]" onClick={() => onChange(undefined)}>
          Clear colour
        </button>
      </div>
    </div>
  )
}

// ---------- Wire library card ----------

export const WirePartCard = memo(function WirePartCard({
  part,
  onDragStart,
  onClick
}: {
  part: WirePart
  onDragStart: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const img = imageUrl(part.imageHash, 'thumb')
  const conductors = part.conductors ?? 1
  const isMultiCore = conductors > 1
  const codes = part.colorCode ? codeSequence(part.colorCode, Math.min(conductors, 12)) : []

  return (
    <button
      className="mb-1 flex w-full cursor-grab flex-col gap-1 rounded border border-edge bg-panelalt p-1.5 text-left hover:border-accent active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={`${part.name}${part.shield ? ' · shielded' : ''}${isMultiCore ? ` · ${conductors}-core` : ''}\n${
        isMultiCore ? 'Click to lay this cable between the selected endpoints' : 'Click to assign to the selected wire'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-edge">
          {img ? (
            <img src={img} className="h-full w-full object-cover" alt="" />
          ) : part.shield ? (
            <Shield size={12} className="text-muted" />
          ) : (
            <Cable size={12} className="text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1 truncate text-xs font-medium">{part.name}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-8 text-[11px] text-muted">
        {part.gauge && <span>{formatGauge(part.gauge)}</span>}
        {isMultiCore && (
          <span className="rounded bg-accent/15 px-1 font-medium text-accent">{conductors}×</span>
        )}
        {part.shield && <Shield size={10} className="text-warn" aria-label="shielded" />}
        {part.category === 'bundle' && (
          <span className="rounded bg-warn/15 px-1 text-warn">bundle</span>
        )}
        {part.colorCode && <span className="rounded bg-panel px-1">{part.colorCode}</span>}
        {!isMultiCore && part.color && !isStripedColor(part.color) && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-edge"
            style={{ background: part.color }}
          />
        )}
      </div>
      {codes.length > 0 && (
        <div className="flex flex-wrap gap-0.5 pl-8">
          {codes.map((abbr, i) => (
            <span
              key={i}
              className="inline-block h-2.5 w-2.5 rounded-full border border-edge"
              style={{ background: codeColor(abbr) }}
              title={COLOR_NAMES[abbr] ?? abbr}
            />
          ))}
          {conductors > codes.length && (
            <span className="text-[11px] text-muted">+{conductors - codes.length}</span>
          )}
        </div>
      )}
    </button>
  )
})
