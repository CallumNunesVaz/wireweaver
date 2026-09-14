import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MenuAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** A compact header dropdown button used to group related actions. */
export function MenuButton({
  label,
  icon,
  items,
  title,
  align = 'right'
}: {
  label?: string
  icon?: ReactNode
  items: MenuAction[]
  title?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        className={`ww-btn ${open ? 'border-accent' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={title}
      >
        {icon}
        {label}
        <ChevronDown size={12} className="text-muted" />
      </button>
      {open && (
        <div
          className={`absolute top-full z-50 mt-1 min-w-[220px] rounded border border-edge bg-panel py-1 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-panelalt disabled:cursor-not-allowed disabled:opacity-40 ${
                it.danger ? 'text-[#e5484d]' : ''
              }`}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
            >
              {it.icon}
              <span className="flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
