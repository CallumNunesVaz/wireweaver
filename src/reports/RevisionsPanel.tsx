import { useMemo, useState } from 'react'
import { History, Plus, RotateCcw, GitCompare } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { confirmDialog, promptDialog } from '../shared/dialogs'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { diffRevisions } from '../model/revisions'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function RevisionsPanel() {
  const close = useUiStore((s) => s.toggleRevisions)
  const project = useProjectStore((s) => s.project)
  const addRevision = useProjectStore((s) => s.addRevision)
  const restoreRevision = useProjectStore((s) => s.restoreRevision)

  const revisions = project.revisions ?? []
  const [selectedId, setSelectedId] = useState<string | null>(
    revisions[0]?.id ?? null
  )

  const selected = revisions.find((r) => r.id === selectedId) ?? null

  const diff = useMemo(() => {
    if (!selected) return []
    return diffRevisions(selected.project, project)
  }, [selected, project])

  const create = async () => {
    const label = await promptDialog({
      title: 'New revision',
      label: 'Label',
      placeholder: 'e.g. A1 — prototype',
      defaultValue: project.revision || `Rev ${revisions.length + 1}`,
      confirmLabel: 'Snapshot'
    })
    if (!label || !label.trim()) return
    addRevision(label.trim())
    toast(`Revision "${label.trim()}" created`, 'success')
  }

  const restore = async () => {
    if (!selected) return
    const ok = await confirmDialog({
      title: 'Restore revision',
      message: `Restore the project to "${selected.label}"?`,
      detail: 'The current state stays available as a revision only if you snapshotted it first.',
      confirmLabel: 'Restore',
      danger: true
    })
    if (!ok) return
    restoreRevision(selected.id)
    toast(`Restored "${selected.label}"`, 'success')
  }

  return (
    <Modal title="Project Revisions" onClose={close} wide>
      <div className="mb-3 flex items-center gap-2">
        <button className="ww-btn" onClick={create}>
          <Plus size={14} /> Snapshot current state
        </button>
        <span className="text-[11px] text-muted">
          {revisions.length} revision{revisions.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-3">
        <div className="max-h-80 space-y-1 overflow-y-auto rounded border border-edge p-1">
          {revisions.length === 0 && (
            <div className="px-2 py-3 text-[11px] text-muted">
              No revisions yet. Snapshot the current state to start a history.
            </div>
          )}
          {[...revisions].reverse().map((r) => (
            <button
              key={r.id}
              className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs hover:bg-panelalt ${
                selectedId === r.id ? 'bg-accent/15 text-accent' : ''
              }`}
              onClick={() => setSelectedId(r.id)}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <History size={12} /> {r.label}
              </span>
              <span className="text-[10px] text-muted">{formatTime(r.timestamp)}</span>
              {r.description && (
                <span className="text-[10px] text-muted">{r.description}</span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-[11px] text-muted">
              Select a revision to compare with the current project.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <GitCompare size={13} /> Changes since “{selected.label}”
                </span>
                <button
                  className="ww-btn ml-auto text-[#e5484d]"
                  onClick={restore}
                  title="Restore this revision"
                >
                  <RotateCcw size={13} /> Restore
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-edge bg-panelalt p-2 text-[11px]">
                {diff.length === 0 ? (
                  <div className="text-muted">No structural differences.</div>
                ) : (
                  <ul className="space-y-0.5">
                    {diff.map((line, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
