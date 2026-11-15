/**
 * One stack for every overlay in the app (modals, full-screen workspaces,
 * popups, menus). It owns three things that used to be re-implemented per
 * component, inconsistently:
 *
 *  - Escape: only the top-most overlay closes. A component that wants to keep
 *    Escape local (e.g. an inline input) calls `e.stopPropagation()` in its
 *    React onKeyDown — the stack listens on window in the bubble phase.
 *  - Z-order: assigned from open order, so whatever opened last is on top
 *    (no more editors hidden behind the Library Manager).
 *  - Focus: dialogs move focus inside on open, trap Tab, and restore focus to
 *    the previously focused element on close.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { create } from 'zustand'

export type OverlayKind = 'workspace' | 'modal' | 'popup'

interface Entry {
  id: number
  kind: OverlayKind
  /** Project undo/redo shortcuts stay live while this overlay is on top. */
  allowsUndo: boolean
}

interface OverlayState {
  stack: Entry[]
}

export const useOverlayStore = create<OverlayState>(() => ({ stack: [] }))

const closers = new Map<number, () => void>()
let seq = 1
const BASE_Z = 40
const STEP_Z = 10

function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const { stack } = useOverlayStore.getState()
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  closers.get(top.id)?.()
}

if (typeof window !== 'undefined' && !(window as { __wwOverlay__?: boolean }).__wwOverlay__) {
  ;(window as { __wwOverlay__?: boolean }).__wwOverlay__ = true
  window.addEventListener('keydown', onWindowKeyDown)
}

/**
 * Register an overlay for as long as the calling component is mounted (and
 * `active` is true). Returns the z-index to apply to the overlay's root.
 */
export function useOverlay(
  onClose: () => void,
  opts: { kind?: OverlayKind; allowsUndo?: boolean; active?: boolean } = {}
): number {
  const { kind = 'modal', allowsUndo = false, active = true } = opts
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = seq++
  const id = idRef.current

  // Keep the latest callback without re-registering on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    if (!active) return
    closers.set(id, () => closeRef.current())
    useOverlayStore.setState((s) => ({ stack: [...s.stack, { id, kind, allowsUndo }] }))
    return () => {
      closers.delete(id)
      useOverlayStore.setState((s) => ({ stack: s.stack.filter((e) => e.id !== id) }))
    }
  }, [id, kind, allowsUndo, active])

  const index = useOverlayStore((s) => s.stack.findIndex((e) => e.id === id))
  return BASE_Z + Math.max(0, index) * STEP_Z
}

/** True while any overlay is open. */
export function useAnyOverlayOpen(): boolean {
  return useOverlayStore((s) => s.stack.length > 0)
}

/** Non-hook read for event handlers. */
export function topOverlay(): Entry | undefined {
  const { stack } = useOverlayStore.getState()
  return stack[stack.length - 1]
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Move focus into `ref` on mount (unless something inside already took it via
 * autoFocus), keep Tab cycling inside it, and give focus back on unmount.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    if (!root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? root).focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [ref])
}

/** Unique id for aria-labelledby wiring. */
export function useStableId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${seq++}`)
  return id
}

/** True when keyboard focus is in a text-editing control. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
      target.type
    )
  }
  return false
}
