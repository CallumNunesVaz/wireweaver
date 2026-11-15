import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useOverlay } from './overlay'
import { useMenuKeyboard } from './ContextMenu'

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
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        className={`ww-btn ${open ? 'border-accent' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        {label}
        <ChevronDown size={12} className="text-muted" aria-hidden />
      </button>
      {open && <MenuList items={items} align={align} onClose={() => setOpen(false)} label={label ?? title} />}
    </div>
  )
}

function MenuList({
  items,
  align,
  onClose,
  label
}: {
  items: MenuAction[]
  align: 'left' | 'right'
  onClose: () => void
  label?: string
}) {
  const close = useCallback(onClose, [onClose])
  const z = useOverlay(close, { kind: 'popup' })
  const ref = useRef<HTMLDivElement>(null)
  useMenuKeyboard(ref)
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`ww-menu absolute top-full mt-1 min-w-[220px] ${align === 'right' ? 'right-0' : 'left-0'}`}
      style={{ zIndex: z }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={it.disabled}
          className={`ww-menu-item ${it.danger ? 'text-danger' : ''}`}
          onClick={() => {
            onClose()
            it.onClick()
          }}
        >
          {it.icon}
          <span className="flex-1 truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
