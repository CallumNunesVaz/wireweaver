import { useMemo } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { runDrc } from '../model/drc'

/** Live design-rule-check results; clicking an issue selects its target. */
export function DrcPanel() {
  const close = useUiStore((s) => s.toggleDrc)
  const select = useUiStore((s) => s.select)
  const project = useProjectStore((s) => s.project)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const lib = useMemo(() => selectLibraryLike({ parts, templates }), [parts, templates])
  const issues = useMemo(() => runDrc(lib, project), [lib, project])

  return (
    <Modal title="Design Rule Check" onClose={close}>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <CircleCheck size={16} className="text-green-500" />
          No issues found.
        </div>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-panelalt ${
                  issue.target ? '' : 'cursor-default'
                }`}
                onClick={() => {
                  if (!issue.target) return
                  select({ type: issue.target.type, id: issue.target.id })
                  close()
                }}
                title={issue.target ? 'Click to select in the assembly view' : undefined}
              >
                {issue.severity === 'error' ? (
                  <CircleAlert size={14} className="mt-0.5 shrink-0 text-red-400" />
                ) : (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                )}
                <span>{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
