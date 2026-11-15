import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { useFocusTrap, useOverlay } from './overlay'

export interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

/** Ctrl+K quick launcher over every registered action. */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const close = useUiStore((s) => s.toggleCommandPalette)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => setIndex(0), [query])

  const z = useOverlay(close, { kind: 'modal' })
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined) => {
    if (!c) return
    close()
    c.run()
  }

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 pt-[12vh]"
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Search size={15} className="text-muted" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Type a command…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="ww-palette-list"
            aria-activedescendant={filtered[index] ? `ww-cmd-${filtered[index].id}` : undefined}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(filtered[index])
              }
            }}
          />
          <span className="text-[11px] text-muted">Esc</span>
        </div>
        <div ref={listRef} id="ww-palette-list" role="listbox" className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted">No matching commands.</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              id={`ww-cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              tabIndex={-1}
              data-active={i === index}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                i === index ? 'bg-accent/15 text-accent' : 'hover:bg-panelalt'
              }`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint && <span className="max-w-[45%] truncate text-[11px] text-muted">{c.hint}</span>}
              {i === index && <CornerDownLeft size={12} className="text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
