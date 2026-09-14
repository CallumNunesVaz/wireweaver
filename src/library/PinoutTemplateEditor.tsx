import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { useLibraryStore } from '../stores/libraryStore'
import { useUiStore } from '../stores/uiStore'
import { SIGNAL_CLASSES, signalColor } from '../shared/signal'
import { isConnector } from '../model/types'
import type { PinDef, PinoutTemplate, SignalClass } from '../model/types'

function blankTemplate(): PinoutTemplate {
  return { id: nanoid(), name: '', connectorPartId: '', pins: [] }
}

/** Resize the pin list to match the connector's position count, preserving edits. */
function fitPins(pins: PinDef[], positions: number): PinDef[] {
  const next: PinDef[] = []
  for (let i = 1; i <= positions; i++) {
    next.push(pins.find((p) => p.position === i) ?? { position: i, signal: '' })
  }
  return next
}

export function PinoutTemplateEditor() {
  const editorId = useUiStore((s) => s.templateEditorId)
  const close = useUiStore((s) => s.closeTemplateEditor)
  const upsertTemplate = useLibraryStore((s) => s.upsertTemplate)
  const connectors = useLibraryStore((s) => s.parts.filter(isConnector))
  const existing = useLibraryStore((s) =>
    editorId ? s.templates.find((t) => t.id === editorId) : undefined
  )

  const [draft, setDraft] = useState<PinoutTemplate>(() =>
    existing ? structuredClone(existing) : blankTemplate()
  )

  const connector = useMemo(
    () => connectors.find((c) => c.id === draft.connectorPartId),
    [connectors, draft.connectorPartId]
  )

  const pins = connector ? fitPins(draft.pins, connector.positions) : draft.pins

  const setPin = (position: number, p: Partial<PinDef>) =>
    setDraft((d) => ({
      ...d,
      pins: fitPins(d.pins, connector?.positions ?? d.pins.length).map((pin) =>
        pin.position === position ? { ...pin, ...p } : pin
      )
    }))

  const pickConnector = (id: string) => {
    const c = connectors.find((x) => x.id === id)
    setDraft((d) => ({
      ...d,
      connectorPartId: id,
      pins: c ? fitPins(d.pins, c.positions) : d.pins
    }))
  }

  const save = () => {
    if (!draft.name.trim()) {
      toast('Please name the template.', 'error')
      return
    }
    if (!draft.connectorPartId) {
      toast('Please choose a connector part.', 'error')
      return
    }
    upsertTemplate({ ...draft, pins })
    close()
  }

  return (
    <Modal
      title={`${existing ? 'Edit' : 'New'} pinout template`}
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ww-label">Name</label>
          <input
            className="ww-input"
            placeholder="CAN + Power (JST GH 4-pos)"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            autoFocus
          />
        </div>
        <div>
          <label className="ww-label">Connector part</label>
          <select
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

      {connector && (
        <div className="mt-4">
          <label className="ww-label">
            Pins — {connector.name} ({connector.positions} positions)
          </label>
          <div className="space-y-1">
            {pins.map((pin) => (
              <div
                key={pin.position}
                className="grid grid-cols-[36px_1fr_150px] items-center gap-2"
              >
                <div
                  className="flex h-7 items-center justify-center rounded text-xs font-semibold text-white"
                  style={{ background: signalColor(pin.signalClass) }}
                >
                  {pin.position}
                </div>
                <input
                  className="ww-input"
                  placeholder={`Signal for pin ${pin.position}`}
                  value={pin.signal}
                  onChange={(e) => setPin(pin.position, { signal: e.target.value })}
                />
                <select
                  className="ww-input"
                  value={pin.signalClass ?? ''}
                  onChange={(e) =>
                    setPin(pin.position, {
                      signalClass: (e.target.value || undefined) as
                        | SignalClass
                        | undefined
                    })
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
    </Modal>
  )
}
