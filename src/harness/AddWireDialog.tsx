import { useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { ListBox } from '../shared/ListBox'
import { isValidWireConnection, wiredPositionsByEnd } from '../model/wiring'
import type { HarnessWire } from '../model/types'

export interface WireEndpointChoice {
  end: string
  title: string
  pins: { position: number; signal: string }[]
}

export interface WirePin {
  end: string
  position: number
}

/**
 * Keyboard-first "Add wire…" dialog. Pick a from-end + pin and a to-end + pin;
 * already-wired pins are disabled and the same-pin / duplicate rules are the
 * same as the drag path (`isValidWireConnection`).
 */
export function AddWireDialog({
  harnessName,
  endpoints,
  wires,
  onAdd,
  onClose
}: {
  harnessName: string
  endpoints: WireEndpointChoice[]
  wires: HarnessWire[]
  onAdd: (from: WirePin, to: WirePin) => void
  onClose: () => void
}) {
  const [fromEnd, setFromEnd] = useState<string>(endpoints[0]?.end ?? '')
  const [toEnd, setToEnd] = useState<string>(endpoints[1]?.end ?? endpoints[0]?.end ?? '')
  // Preselect the obvious wire: the first free pin on the "from" end and the
  // free pin with the same signal name on the "to" end (else its first free
  // pin), so the common case is a single Enter.
  const [initial] = useState(() => {
    const w = wiredPositionsByEnd(wires, endpoints.length)
    const a = endpoints[0]
    const b = endpoints[1] ?? endpoints[0]
    const freeA = (a?.pins ?? []).filter((p) => !w[a.end]?.has(p.position))
    const freeB = (b?.pins ?? []).filter((p) => !w[b.end]?.has(p.position))
    const from = freeA[0]
    const sig = from?.signal.trim().toLowerCase()
    const to =
      freeB.find((p) => sig && p.signal.trim().toLowerCase() === sig && !(a.end === b.end && p.position === from?.position)) ??
      freeB.find((p) => !(a.end === b.end && p.position === from?.position))
    return { from: from?.position ?? null, to: to?.position ?? null }
  })
  const [fromPin, setFromPin] = useState<number | null>(initial.from)
  const [toPin, setToPin] = useState<number | null>(initial.to)

  const wired = useMemo(() => wiredPositionsByEnd(wires, endpoints.length), [wires, endpoints.length])
  const endOptions = useMemo(() => endpoints.map((e) => ({ value: e.end, label: e.title })), [endpoints])

  const fromEndpoint = endpoints.find((e) => e.end === fromEnd)
  const toEndpoint = endpoints.find((e) => e.end === toEnd)

  const fromPinOptions = useMemo(() => {
    const w = wired[fromEnd] ?? new Set<number>()
    return (fromEndpoint?.pins ?? []).map((p) => ({
      value: String(p.position),
      label: `${p.position}${p.signal ? ` · ${p.signal}` : ''}`,
      note: w.has(p.position) ? 'wired' : undefined,
      disabled: w.has(p.position)
    }))
  }, [fromEnd, fromEndpoint, wired])

  const toPinOptions = useMemo(() => {
    const w = wired[toEnd] ?? new Set<number>()
    return (toEndpoint?.pins ?? []).map((p) => ({
      value: String(p.position),
      label: `${p.position}${p.signal ? ` · ${p.signal}` : ''}`,
      note: w.has(p.position) ? 'wired' : undefined,
      disabled: w.has(p.position)
    }))
  }, [toEnd, toEndpoint, wired])

  const valid = useMemo(() => {
    if (fromPin == null || toPin == null || !fromEnd || !toEnd) return false
    return isValidWireConnection(
      wires,
      { end: fromEnd, position: fromPin },
      { end: toEnd, position: toPin }
    )
  }, [fromPin, toPin, fromEnd, toEnd, wires])

  const confirm = () => {
    if (!valid || fromPin == null || toPin == null) return
    onAdd({ end: fromEnd, position: fromPin }, { end: toEnd, position: toPin })
  }

  return (
    <Modal
      title={`Add wire — ${harnessName}`}
      onClose={onClose}
      footer={
        <>
          <button className="ww-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ww-btn-primary" onClick={confirm} disabled={!valid} autoFocus={valid}>
            Add wire
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ww-label" htmlFor="ww-add-wire-from-end">
            From
          </label>
          <select
            id="ww-add-wire-from-end"
            className="ww-input mb-1"
            value={fromEnd}
            onChange={(e) => {
              setFromEnd(e.target.value)
              setFromPin(null)
            }}
          >
            {endOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ListBox
            label="From pin"
            options={fromPinOptions}
            selected={fromPin != null ? String(fromPin) : null}
            onSelect={(v) => setFromPin(Number(v))}
            emptyText="No pins on this endpoint."
          />
        </div>

        <div>
          <label className="ww-label" htmlFor="ww-add-wire-to-end">
            To
          </label>
          <select
            id="ww-add-wire-to-end"
            className="ww-input mb-1"
            value={toEnd}
            onChange={(e) => {
              setToEnd(e.target.value)
              setToPin(null)
            }}
          >
            {endOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ListBox
            label="To pin"
            options={toPinOptions}
            selected={toPin != null ? String(toPin) : null}
            onSelect={(v) => setToPin(Number(v))}
            emptyText="No pins on this endpoint."
          />
        </div>
      </div>

      {fromPin != null && toPin != null && !valid && (
        <div className="mt-3 text-[11px] text-muted">Choose two different, unwired pins.</div>
      )}
    </Modal>
  )
}
