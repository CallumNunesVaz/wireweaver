import { useState } from 'react'
import { Modal } from '../shared/Modal'
import { useUiStore } from '../stores/uiStore'
import { useLibraryStore } from '../stores/libraryStore'

export function ReconciliationDialog() {
  const items = useUiStore((s) => s.reconciliationItems)
  const show = useUiStore((s) => s.showReconciliation)
  const dismiss = useUiStore((s) => s.dismissReconciliation)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const upsertTemplate = useLibraryStore((s) => s.upsertTemplate)

  const [checkedParts, setCheckedParts] = useState<Set<string>>(
    new Set(items.parts.map((p) => p.id))
  )
  const [checkedTemplates, setCheckedTemplates] = useState<Set<string>>(
    new Set(items.templates.map((t) => t.id))
  )

  if (!show) return null

  const total = items.parts.length + items.templates.length
  const selected = checkedParts.size + checkedTemplates.size

  const togglePart = (id: string) => {
    setCheckedParts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTemplate = (id: string) => {
    setCheckedTemplates((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleImport = () => {
    for (const p of items.parts) {
      if (checkedParts.has(p.id)) upsertPart(p)
    }
    for (const t of items.templates) {
      if (checkedTemplates.has(t.id)) upsertTemplate(t)
    }
    dismiss()
  }

  const selectAll = () => {
    setCheckedParts(new Set(items.parts.map((p) => p.id)))
    setCheckedTemplates(new Set(items.templates.map((t) => t.id)))
  }

  return (
    <Modal
      title={`New Parts & Templates Found (${total})`}
      onClose={dismiss}
      wide
      footer={
        <>
          <button className="ww-btn" onClick={dismiss}>
            Skip All
          </button>
          <div className="flex-1" />
          <button className="ww-btn" onClick={selectAll}>
            Select All
          </button>
          <button
            className="ww-btn-primary"
            onClick={handleImport}
            disabled={selected === 0}
          >
            Import {selected} item{selected === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">
        This project references parts or templates not found in your library.
        Select which ones to import.
      </p>

      {items.parts.length > 0 && (
        <div className="mb-3">
          <div className="ww-label">Parts ({items.parts.length})</div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-edge p-1">
            {items.parts.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-panelalt"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={checkedParts.has(p.id)}
                  onChange={() => togglePart(p.id)}
                />
                <span className="font-medium">{p.name || '(unnamed)'}</span>
                <span className="text-muted capitalize">{p.kind}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {items.templates.length > 0 && (
        <div>
          <div className="ww-label">Templates ({items.templates.length})</div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-edge p-1">
            {items.templates.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-panelalt"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={checkedTemplates.has(t.id)}
                  onChange={() => toggleTemplate(t.id)}
                />
                <span className="font-medium">{t.name || '(unnamed)'}</span>
                <span className="text-muted">{t.pins.length} pins</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
