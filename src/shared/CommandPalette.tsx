import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'

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
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Search size={15} className="text-muted" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Type a command…"
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
          <span className="text-[10px] text-muted">Esc</span>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted">No matching commands.</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              data-active={i === index}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                i === index ? 'bg-accent/15 text-accent' : 'hover:bg-panelalt'
              }`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint && <span className="text-[10px] text-muted">{c.hint}</span>}
              {i === index && <CornerDownLeft size={12} className="text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
