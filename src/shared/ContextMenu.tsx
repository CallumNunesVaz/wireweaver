import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useOverlay } from './overlay'

export interface CtxItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  note?: string // tooltip, e.g. why an item is disabled
  onClick: () => void
}

/**
 * Arrow/Home/End navigation between the menu's items, focus on the first item
 * when it opens, and focus returned to where it was when it closes.
 */
export function useMenuKeyboard(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const items = () =>
      [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter((b) => !b.disabled)
    items()[0]?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      const list = items()
      if (list.length === 0) return
      const i = list.indexOf(document.activeElement as HTMLButtonElement)
      let next = -1
      if (e.key === 'ArrowDown') next = (i + 1) % list.length
      else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = list.length - 1
      else if (e.key === 'Tab') e.preventDefault()
      if (next >= 0) {
        e.preventDefault()
        list[next].focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [ref])
}

/**
 * Shared right-click menu. Positioned with `fixed` in viewport coordinates so
 * callers can pass MouseEvent clientX/clientY directly, and kept on screen.
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
  const z = useOverlay(onClose, { kind: 'popup' })
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useMenuKeyboard(ref)

  // Measure, then clamp into the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4))
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="ww-menu fixed"
      style={{ ...pos, zIndex: z }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={it.disabled}
          title={it.note}
          className={`ww-menu-item ${it.danger ? 'text-danger' : ''}`}
          onClick={() => {
            onClose()
            it.onClick()
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}
