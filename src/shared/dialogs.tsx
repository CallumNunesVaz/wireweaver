import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { useFocusTrap, useOverlay, useStableId } from './overlay'

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

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  primary?: boolean
  danger?: boolean
}

export interface ChoiceOptions<T extends string> {
  title?: string
  message: string
  detail?: string
  /** Buttons, left to right. Escape / backdrop resolve null. */
  choices: ChoiceOption<T>[]
}

type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | {
      id: number
      kind: 'choice'
      opts: ChoiceOptions<string>
      resolve: (v: string | null) => void
    }

interface DialogState {
  current: DialogRequest | null
  /** Requests made while another dialog is showing; shown in order. */
  pending: DialogRequest[]
  open: (r: DialogRequest) => void
  close: (result: boolean | string | null) => void
}

const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  pending: [],
  open: (r) => {
    const { current, pending } = get()
    if (current) set({ pending: [...pending, r] })
    else set({ current: r })
  },
  close: (result) => {
    const { current: cur, pending } = get()
    if (!cur) return
    if (cur.kind === 'confirm') cur.resolve(result === true)
    else cur.resolve(typeof result === 'string' ? result : null)
    set({ current: pending[0] ?? null, pending: pending.slice(1) })
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

/** A dialog with several explicit outcomes; resolves the chosen value or null. */
export function choiceDialog<T extends string>(opts: ChoiceOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({
      id: seq++,
      kind: 'choice',
      opts: opts as ChoiceOptions<string>,
      resolve: resolve as (v: string | null) => void
    })
  })
}

/** Host rendered once near the app root. */
export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  if (!current) return null
  // Keyed so each request gets a fresh overlay registration and focus trap.
  return <DialogView key={current.id} request={current} />
}

function DialogView({ request }: { request: DialogRequest }) {
  const close = useDialogStore((s) => s.close)
  const [value, setValue] = useState(
    request.kind === 'prompt' ? request.opts.defaultValue ?? '' : ''
  )
  const cancelValue = request.kind === 'confirm' ? false : null
  const z = useOverlay(() => close(cancelValue), { kind: 'modal' })
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)
  const titleId = useStableId('dlg-title')
  const descId = useStableId('dlg-desc')

  // Select the default text of a prompt so typing replaces it.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const opts = request.opts
  const isConfirm = request.kind === 'confirm'
  const danger = isConfirm && (opts as ConfirmOptions).danger
  const title =
    opts.title ?? (isConfirm ? 'Confirm' : request.kind === 'prompt' ? 'Enter a value' : 'Choose')
  const detail = 'detail' in opts ? opts.detail : undefined

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(cancelValue)
      }}
    >
      <div
        ref={panelRef}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg border border-edge bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          {danger ? (
            <AlertTriangle size={16} className="text-danger" />
          ) : (
            <HelpCircle size={16} className="text-accent" />
          )}
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
        </div>
        <div id={descId} className="space-y-3 p-4">
          {opts.message && <div className="text-xs">{opts.message}</div>}
          {detail && <div className="whitespace-pre-line text-[11px] text-muted">{detail}</div>}
          {request.kind === 'prompt' && (
            <div>
              {request.opts.label && (
                <label className="ww-label" htmlFor={`${titleId}-input`}>
                  {request.opts.label}
                </label>
              )}
              <input
                id={`${titleId}-input`}
                ref={inputRef}
                className="ww-input"
                autoFocus
                value={value}
                placeholder={request.opts.placeholder}
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
          {request.kind === 'choice' ? (
            request.opts.choices.map((c) => (
              <button
                key={c.value}
                className={c.primary ? 'ww-btn-primary' : c.danger ? 'ww-btn text-danger' : 'ww-btn'}
                autoFocus={c.primary}
                onClick={() => close(c.value)}
              >
                {c.label}
              </button>
            ))
          ) : (
            <>
              <button className="ww-btn" autoFocus={!!danger} onClick={() => close(cancelValue)}>
                {(opts as ConfirmOptions).cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={danger ? 'ww-btn text-danger' : 'ww-btn-primary'}
                autoFocus={isConfirm && !danger}
                onClick={() => close(isConfirm ? true : value)}
              >
                {(opts as ConfirmOptions).confirmLabel ?? (isConfirm ? 'Confirm' : 'OK')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
