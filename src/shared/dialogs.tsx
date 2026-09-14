import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, HelpCircle } from 'lucide-react'

export interface ConfirmOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title?: string
  message?: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }

interface DialogState {
  current: DialogRequest | null
  open: (r: DialogRequest) => void
  close: (result: boolean | string | null) => void
}

const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  open: (current) => set({ current }),
  close: (result) => {
    const cur = get().current
    if (!cur) return
    if (cur.kind === 'confirm') cur.resolve(result === true)
    else cur.resolve(typeof result === 'string' ? result : null)
    set({ current: null })
  }
}))

let seq = 1

/** Themed replacement for window.confirm; resolves true on confirm. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ id: seq++, kind: 'confirm', opts, resolve })
  })
}

/** Themed replacement for window.prompt; resolves the string, or null on cancel. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ id: seq++, kind: 'prompt', opts, resolve })
  })
}

/** Host rendered once near the app root. */
export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  const close = useDialogStore((s) => s.close)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (current?.kind === 'prompt') setValue(current.opts.defaultValue ?? '')
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(current.kind === 'confirm' ? false : null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, close])

  if (!current) return null

  const isConfirm = current.kind === 'confirm'
  const opts = current.opts
  const title = opts.title ?? (isConfirm ? 'Confirm' : 'Enter a value')
  const confirmLabel = opts.confirmLabel ?? (isConfirm ? 'Confirm' : 'OK')
  const cancelLabel = opts.cancelLabel ?? 'Cancel'
  const danger = isConfirm && (opts as ConfirmOptions).danger

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onMouseDown={() => close(isConfirm ? false : null)}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-edge bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          {danger ? (
            <AlertTriangle size={16} className="text-[#e5484d]" />
          ) : (
            <HelpCircle size={16} className="text-accent" />
          )}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <div className="space-y-3 p-4">
          {opts.message && <div className="text-xs">{opts.message}</div>}
          {isConfirm && (opts as ConfirmOptions).detail && (
            <div className="text-[11px] text-muted">{(opts as ConfirmOptions).detail}</div>
          )}
          {!isConfirm && (
            <div>
              {(opts as PromptOptions).label && (
                <label className="ww-label">{(opts as PromptOptions).label}</label>
              )}
              <input
                className="ww-input"
                autoFocus
                value={value}
                placeholder={(opts as PromptOptions).placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    close(value)
                  }
                }}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <button className="ww-btn" onClick={() => close(isConfirm ? false : null)}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'ww-btn text-[#e5484d]' : 'ww-btn-primary'}
            onClick={() => close(isConfirm ? true : value)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
