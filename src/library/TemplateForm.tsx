/**
 * The one pinout-template form, used by the template modal and the Library
 * Manager. The pin list always matches the chosen connector's position count.
 */
import { useMemo } from 'react'
import { nanoid } from 'nanoid'
import type { ConnectorPart, PinDef, PinoutTemplate, SignalClass } from '../model/types'
import { SIGNAL_CLASSES, signalColor } from '../shared/signal'

export function blankTemplate(): PinoutTemplate {
  return { id: nanoid(), name: '', connectorPartId: '', pins: [] }
}

/** Resize the pin list to the connector's position count, preserving edits. */
export function fitPins(pins: PinDef[], positions: number): PinDef[] {
  const byPos = new Map(pins.map((p) => [p.position, p]))
  const next: PinDef[] = []
  for (let i = 1; i <= positions; i++) next.push(byPos.get(i) ?? { position: i, signal: '' })
  return next
}

export function validateTemplate(draft: PinoutTemplate): string | null {
  if (!draft.name.trim()) return 'Give the template a name.'
  if (!draft.connectorPartId) return 'Choose a connector part.'
  return null
}

export function TemplateForm({
  draft,
  onChange,
  connectors
}: {
  draft: PinoutTemplate
  onChange: (next: PinoutTemplate) => void
  connectors: ConnectorPart[]
}) {
  const connector = useMemo(
    () => connectors.find((c) => c.id === draft.connectorPartId),
    [connectors, draft.connectorPartId]
  )
  const pins = connector ? fitPins(draft.pins, connector.positions) : draft.pins

  const setPin = (position: number, p: Partial<PinDef>) =>
    onChange({ ...draft, pins: pins.map((pin) => (pin.position === position ? { ...pin, ...p } : pin)) })

  const pickConnector = (id: string) => {
    const c = connectors.find((x) => x.id === id)
    onChange({ ...draft, connectorPartId: id, pins: c ? fitPins(draft.pins, c.positions) : draft.pins })
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ww-label" htmlFor="ww-tpl-name">
            Name
          </label>
          <input
            id="ww-tpl-name"
            className="ww-input"
            placeholder="CAN + Power (JST GH 4-pos)"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            autoFocus
          />
        </div>
        <div>
          <label className="ww-label" htmlFor="ww-tpl-conn">
            Connector part
          </label>
          <select
            id="ww-tpl-conn"
            className="ww-input"
            value={draft.connectorPartId}
            onChange={(e) => pickConnector(e.target.value)}
          >
            <option value="">— select connector —</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.positions}-pos)
              </option>
            ))}
          </select>
        </div>
      </div>

      {connectors.length === 0 && (
        <div className="mt-3 rounded border border-dashed border-edge px-3 py-4 text-center text-[11px] text-muted">
          No connector parts exist yet. Create a connector in the library first.
        </div>
      )}
      {connectors.length > 0 && !connector && (
        <div className="mt-3 text-[11px] text-muted">Choose a connector to define its pins.</div>
      )}

      {connector && (
        <div className="mt-4">
          <div className="ww-label">
            Pins — {connector.name} ({connector.positions} positions)
          </div>
          <div className="space-y-1">
            {pins.map((pin) => (
              <div key={pin.position} className="grid grid-cols-[36px_1fr_150px] items-center gap-2">
                <div
                  className="flex h-7 items-center justify-center rounded text-xs font-semibold text-white"
                  style={{ background: signalColor(pin.signalClass) }}
                  aria-hidden
                >
                  {pin.position}
                </div>
                <input
                  className="ww-input"
                  aria-label={`Signal for pin ${pin.position}`}
                  placeholder={`Signal for pin ${pin.position}`}
                  value={pin.signal}
                  onChange={(e) => setPin(pin.position, { signal: e.target.value })}
                />
                <select
                  className="ww-input"
                  aria-label={`Signal class for pin ${pin.position}`}
                  value={pin.signalClass ?? ''}
                  onChange={(e) =>
                    setPin(pin.position, { signalClass: (e.target.value || undefined) as SignalClass | undefined })
                  }
                >
                  <option value="">unclassified</option>
                  {SIGNAL_CLASSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Normalise a template's pins to its connector before saving. */
export function finalizeTemplate(draft: PinoutTemplate, connectors: ConnectorPart[]): PinoutTemplate {
  const c = connectors.find((x) => x.id === draft.connectorPartId)
  return c ? { ...draft, pins: fitPins(draft.pins, c.positions) } : draft
}
