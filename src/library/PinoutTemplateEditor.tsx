import { useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { useLibraryStore } from '../stores/libraryStore'
import { useUiStore } from '../stores/uiStore'
import { isConnector, type PinoutTemplate } from '../model/types'
import { TemplateForm, blankTemplate, finalizeTemplate, validateTemplate } from './TemplateForm'

/** Modal template editor: edits a draft and writes the library only on Save. */
export function PinoutTemplateEditor() {
  const editorId = useUiStore((s) => s.templateEditorId)
  const close = useUiStore((s) => s.closeTemplateEditor)
  const upsertTemplate = useLibraryStore((s) => s.upsertTemplate)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const connectors = useMemo(() => parts.filter(isConnector), [parts])
  const existing = useMemo(
    () => (editorId ? templates.find((t) => t.id === editorId) : undefined),
    [templates, editorId]
  )

  const [initial] = useState<PinoutTemplate>(() => (existing ? structuredClone(existing) : blankTemplate()))
  const [draft, setDraft] = useState<PinoutTemplate>(initial)
  const dirty = draft !== initial

  const save = () => {
    const problem = validateTemplate(draft)
    if (problem) {
      toast(problem, 'error')
      return
    }
    upsertTemplate(finalizeTemplate(draft, connectors))
    close()
  }

  return (
    <Modal
      title={`${existing ? 'Edit' : 'New'} pinout template`}
      onClose={close}
      dirty={dirty}
      wide
      footer={
        <>
          <button className="ww-btn" onClick={close}>
            {dirty ? 'Discard' : 'Cancel'}
          </button>
          <button className="ww-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <TemplateForm draft={draft} onChange={setDraft} connectors={connectors} />
    </Modal>
  )
}
