import { useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { useLibraryStore } from '../stores/libraryStore'
import { useUiStore } from '../stores/uiStore'
import { isConnector, type Part } from '../model/types'
import { PartForm, blankPart, validatePart } from './PartForm'

/** Modal part editor: edits a draft and writes the library only on Save. */
export function PartEditor({ onClose }: { onClose: () => void }) {
  const target = useUiStore((s) => s.partEditor)!
  const openTemplateEditor = useUiStore((s) => s.openTemplateEditor)
  const upsertPart = useLibraryStore((s) => s.upsertPart)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const existing = useMemo(
    () => (target.partId ? parts.find((p) => p.id === target.partId) : undefined),
    [parts, target.partId]
  )
  const connectors = useMemo(
    () => parts.filter(isConnector).map((c) => ({ id: c.id, name: c.name })),
    [parts]
  )

  const [initial] = useState<Part>(() =>
    existing ? structuredClone(existing) : blankPart(target.kind === 'subassembly' ? 'device' : target.kind)
  )
  const [draft, setDraft] = useState<Part>(initial)
  const dirty = draft !== initial

  const save = () => {
    const problem = validatePart(draft)
    if (problem) {
      toast(problem, 'error')
      return
    }
    upsertPart(draft)
    onClose()
  }

  return (
    <Modal
      title={`${existing ? 'Edit' : 'New'} ${draft.kind}`}
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted">
            {existing ? 'Changes apply to every project that uses this part.' : ''}
          </span>
          <button className="ww-btn" onClick={onClose}>
            {dirty ? 'Discard' : 'Cancel'}
          </button>
          <button className="ww-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <PartForm
        draft={draft}
        onChange={setDraft}
        templates={templates}
        connectors={connectors}
        onNewTemplate={() => openTemplateEditor(null)}
      />
    </Modal>
  )
}
