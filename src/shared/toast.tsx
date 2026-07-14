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
  push: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

let nextId = 1

export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = nextId++
  useToastStore.getState().push({ id, message, kind })
  setTimeout(() => useToastStore.getState().dismiss(id), 4500)
}

const KIND_STYLE: Record<ToastKind, { border: string; icon: JSX.Element }> = {
  info: { border: 'border-edge', icon: <Info size={15} className="text-accent" /> },
  success: {
    border: 'border-[#3fb27f]/50',
    icon: <CheckCircle2 size={15} className="text-[#3fb27f]" />
  },
  error: {
    border: 'border-[#e5484d]/50',
    icon: <AlertTriangle size={15} className="text-[#e5484d]" />
  }
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded border ${style.border}
              bg-panel px-3 py-2 text-xs shadow-xl`}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button className="text-muted hover:text-ink" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
