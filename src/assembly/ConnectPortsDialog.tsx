import { useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { ListBox } from '../shared/ListBox'
import { useProjectStore } from '../stores/projectStore'
import { useEffectiveLibrary } from '../stores/effectiveLibrary'
import { useUiStore } from '../stores/uiStore'
import { findHarnessByEndpoint, planConnection } from '../model/connection'
import { isDevice, type HarnessEndpoint } from '../model/types'
import { toast } from '../shared/toast'

interface TargetPort {
  instanceId: string
  portId: string
}

/**
 * Keyboard-first "Connect ports…" dialog. Pick a source port on the selected
 * device and a target port on another placed device, then confirm. Mirrors the
 * drag-port-to-port gesture by delegating the decision to `planConnection`.
 */
export function ConnectPortsDialog({
  instanceId,
  onClose
}: {
  instanceId: string
  onClose: () => void
}) {
  const instances = useProjectStore((s) => s.project.deviceInstances)
  const harnesses = useProjectStore((s) => s.project.harnesses)
  const { lib } = useEffectiveLibrary()

  const source = instances.find((i) => i.id === instanceId)
  const sourcePart = source ? lib.parts[source.partId] : undefined
  const sourceDevice = sourcePart && isDevice(sourcePart) ? sourcePart : undefined
  const sourcePorts = useMemo(() => sourceDevice?.ports ?? [], [sourceDevice])

  const targetOptions = useMemo(() => {
    const out: { instanceId: string; portId: string; label: string; inHarness: boolean }[] = []
    for (const inst of instances) {
      if (inst.id === instanceId) continue
      const part = lib.parts[inst.partId]
      if (!part || !isDevice(part)) continue
      for (const port of part.ports) {
        out.push({
          instanceId: inst.id,
          portId: port.id,
          label: `${inst.label} · ${port.name}`,
          inHarness: !!findHarnessByEndpoint(harnesses, inst.id, port.id)
        })
      }
    }
    return out
  }, [instances, instanceId, lib, harnesses])

  const sourceOptions = useMemo(
    () =>
      sourcePorts.map((p) => ({
        value: p.id,
        label: p.name,
        note: findHarnessByEndpoint(harnesses, instanceId, p.id) ? 'in harness' : undefined
      })),
    [sourcePorts, harnesses, instanceId]
  )

  // Preselect the obvious source: the first port not yet in a harness (or the
  // only port), so the common case is "pick a target, press Connect".
  const [sourcePortId, setSourcePortId] = useState<string | null>(
    () =>
      sourcePorts.find((p) => !findHarnessByEndpoint(harnesses, instanceId, p.id))?.id ??
      sourcePorts[0]?.id ??
      null
  )
  const [target, setTarget] = useState<TargetPort | null>(null)
  const [query, setQuery] = useState('')

  const filteredTargets = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return targetOptions
    return targetOptions.filter((t) => t.label.toLowerCase().includes(q))
  }, [targetOptions, query])

  const canConfirm = sourcePortId != null && target != null

  const confirm = () => {
    if (!sourcePortId || !target) return
    const ep1: HarnessEndpoint = { deviceInstanceId: instanceId, portId: sourcePortId }
    const ep2: HarnessEndpoint = { deviceInstanceId: target.instanceId, portId: target.portId }
    const st = useProjectStore.getState()
    const plan = planConnection(st.project, ep1, ep2)
    if (plan.kind === 'error') {
      toast(plan.message, 'error')
      return
    }
    if (plan.kind === 'create') {
      const id = st.addHarness([ep1, ep2])
      if (id) useUiStore.getState().select({ type: 'harness', id })
    } else if (plan.kind === 'join') {
      st.addEndpointToHarness(plan.harnessId, plan.endpoint)
      useUiStore.getState().select({ type: 'harness', id: plan.harnessId })
    }
    onClose()
  }

  return (
    <Modal
      title="Connect ports"
      onClose={onClose}
      footer={
        <>
          <button className="ww-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ww-btn-primary" onClick={confirm} disabled={!canConfirm}>
            Connect
          </button>
        </>
      }
    >
      {!source ? (
        <div className="text-xs text-muted">The selected device no longer exists.</div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="ww-label">Source port on {source.label}</span>
            {sourcePorts.length === 0 ? (
              <div className="text-[11px] text-muted">This device has no ports.</div>
            ) : (
              <ListBox
                label={`Source port on ${source.label}`}
                options={sourceOptions}
                selected={sourcePortId}
                onSelect={setSourcePortId}
                emptyText="No ports on this device."
              />
            )}
          </div>

          <div>
            <label className="ww-label" htmlFor="ww-connect-target-search">
              Target port
            </label>
            <input
              id="ww-connect-target-search"
              className="ww-input mb-1"
              placeholder="Search devices and ports…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the target when the search narrows to one port.
                if (e.key === 'Enter' && filteredTargets.length === 1) {
                  e.preventDefault()
                  const t = filteredTargets[0]
                  setTarget({ instanceId: t.instanceId, portId: t.portId })
                }
              }}
              aria-label="Search target devices and ports"
            />
            {targetOptions.length === 0 ? (
              <div className="text-[11px] text-muted">
                Place another device to connect to it.
              </div>
            ) : (
              <ListBox
                label="Target port"
                options={filteredTargets.map((t) => ({
                  value: `${t.instanceId}|${t.portId}`,
                  label: t.label,
                  note: t.inHarness ? 'in harness' : undefined
                }))}
                selected={target ? `${target.instanceId}|${target.portId}` : null}
                onSelect={(v) => {
                  const sep = v.indexOf('|')
                  setTarget({ instanceId: v.slice(0, sep), portId: v.slice(sep + 1) })
                }}
                emptyText="No matching ports."
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
