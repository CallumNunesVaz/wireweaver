import { useEffect, type ReactNode } from 'react'

export interface CtxItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  note?: string // tooltip, e.g. why an item is disabled
  onClick: () => void
}

/**
 * Shared right-click menu. Positioned with `fixed` in viewport coordinates so
 * callers can pass MouseEvent clientX/clientY directly regardless of container.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: CtxItem[]
  onClose: () => void
}) {
  useEffect(() => {
    const onDown = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onDown)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 210)
  const top = Math.min(y, window.innerHeight - 220)

  return (
    <div
      className="fixed z-50 min-w-[190px] rounded border border-edge bg-panel py-1 shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          title={it.note}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-panelalt
            disabled:cursor-not-allowed disabled:opacity-40 ${
              it.danger ? 'text-[#e5484d]' : ''
            }`}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}
