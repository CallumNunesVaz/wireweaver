import { useCallback, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap, useOverlay, useStableId } from './overlay'
import { confirmDialog } from './dialogs'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /**
   * When true, closing without saving (Escape, backdrop, ✕, or a footer
   * button that calls the `requestClose` passed to `footer`) asks first.
   */
  dirty?: boolean
}

/** Ask before discarding unsaved edits; resolves true when it is OK to close. */
export async function confirmDiscardEdits(): Promise<boolean> {
  return confirmDialog({
    title: 'Discard changes?',
    message: 'You have unsaved edits in this dialog.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    danger: true
  })
}

export function Modal({ title, onClose, children, footer, wide, dirty }: ModalProps) {
  const requestClose = useCallback(async () => {
    if (dirty && !(await confirmDiscardEdits())) return
    onClose()
  }, [dirty, onClose])

  const z = useOverlay(requestClose, { kind: 'modal' })
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)
  const titleId = useStableId('modal-title')

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void requestClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[88vh] w-full ${
          wide ? 'max-w-4xl' : 'max-w-lg'
        } flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl outline-none`}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <button
            className="ww-icon-btn"
            onClick={() => void requestClose()}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
