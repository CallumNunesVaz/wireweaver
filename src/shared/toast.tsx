import { create } from 'zustand'
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'

type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: ToastItem[]
  push: (t: ToastItem) => void
  dismiss: (id: number) => void
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts.slice(-4), t] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

let nextId = 1

/** Errors stay until dismissed; everything else fades after a few seconds. */
const LIFETIME_MS: Record<ToastKind, number | null> = { info: 4500, success: 4500, error: null }

export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = nextId++
  useToastStore.getState().push({ id, message, kind })
  const ms = LIFETIME_MS[kind]
  if (ms) setTimeout(() => useToastStore.getState().dismiss(id), ms)
}

const KIND_STYLE: Record<ToastKind, { border: string; icon: JSX.Element }> = {
  info: { border: 'border-edge', icon: <Info size={15} className="text-accent" /> },
  success: { border: 'border-success/50', icon: <CheckCircle2 size={15} className="text-success" /> },
  error: { border: 'border-danger/60', icon: <AlertTriangle size={15} className="text-danger" /> }
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 flex w-80 flex-col gap-2"
      style={{ zIndex: 1000 }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : undefined}
            className={`pointer-events-auto flex items-start gap-2 rounded border ${style.border} bg-panel px-3 py-2 text-xs shadow-xl`}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button className="ww-icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
