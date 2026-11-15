import { useEffect } from 'react'
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  ChevronUp,
  ChevronDown,
  X,
  ShieldCheck
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useDrcIssues } from '../stores/effectiveLibrary'
import { useDrcPending } from '../stores/drcScheduler'

/**
 * Persistent design-rule-check side panel. Unlike a modal it stays open while
 * you fix issues, highlights the current one, and supports issue-to-issue
 * navigation without losing your place.
 */
export function DrcPanel() {
  const close = useUiStore((s) => s.toggleDrc)
  const select = useUiStore((s) => s.select)
  const index = useUiStore((s) => s.drcIndex)
  const setIndex = useUiStore((s) => s.setDrcIndex)
  const project = useProjectStore((s) => s.project)
  const issues = useDrcIssues()
  const pending = useDrcPending()

  const errors = issues.filter((i) => i.severity === 'error').length
  const current = issues[Math.min(index, Math.max(0, issues.length - 1))]

  // Keep the highlight in range as issues appear/disappear.
  useEffect(() => {
    if (index >= issues.length) setIndex(issues.length === 0 ? 0 : issues.length - 1)
  }, [issues.length, index, setIndex])

  const go = (delta: number) => {
    if (issues.length === 0) return
    const next = (index + delta + issues.length) % issues.length
    setIndex(next)
    const target = issues[next]?.target
    if (target) select({ type: target.type, id: target.id })
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel" aria-label="Design rule check">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <ShieldCheck size={15} className="text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wide">Design Rule Check</span>
        <button className="ww-icon-btn ml-auto" onClick={close} title="Close" aria-label="Close design rule check">
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-[11px]">
        <span className={errors > 0 ? 'text-danger' : 'text-muted'}>
          {errors} error{errors === 1 ? '' : 's'}
        </span>
        <span className="text-muted">·</span>
        <span className="text-warn">
          {issues.length - errors} warning{issues.length - errors === 1 ? '' : 's'}
        </span>
        {pending && (
          <span className="animate-pulse text-[11px] text-muted" aria-live="polite">
            checking…
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="ww-btn px-1.5 py-0.5"
            onClick={() => go(-1)}
            disabled={issues.length === 0}
            title="Previous issue"
            aria-label="Previous issue"
          >
            <ChevronUp size={13} />
          </button>
          <span className="text-muted">
            {issues.length === 0 ? '0' : Math.min(index + 1, issues.length)}/{issues.length}
          </span>
          <button
            className="ww-btn px-1.5 py-0.5"
            onClick={() => go(1)}
            disabled={issues.length === 0}
            title="Next issue"
            aria-label="Next issue"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted">
            <CircleCheck size={16} className="text-success" />
            No issues found.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    i === index ? 'bg-accent/15 text-accent' : 'hover:bg-panelalt'
                  } ${issue.target ? '' : 'cursor-default'}`}
                  onClick={() => {
                    setIndex(i)
                    if (issue.target) select({ type: issue.target.type, id: issue.target.id })
                  }}
                  title={issue.target ? 'Select in the assembly view' : undefined}
                >
                  {issue.severity === 'error' ? (
                    <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                  )}
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {current && (
        <div className="border-t border-edge px-3 py-2 text-[11px] text-muted">
          {current.target
            ? `Applies to ${current.target.type === 'instance' ? 'device' : 'harness'} "${
                current.target.type === 'instance'
                  ? project.deviceInstances.find((d) => d.id === current.target!.id)?.label ?? '?'
                  : project.harnesses.find((h) => h.id === current.target!.id)?.name ?? '?'
              }" — click the issue to select it.`
            : 'This issue applies to the whole project.'}
        </div>
      )}
    </aside>
  )
}
