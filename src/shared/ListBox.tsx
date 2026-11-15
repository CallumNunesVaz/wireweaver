import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface ListBoxOption {
  value: string
  label: string
  note?: string
  disabled?: boolean
}

/**
 * Accessible single-select listbox: keyboard arrows/Home/End move the active
 * option, Enter/Space selects, and click selects. Focus stays on the listbox
 * itself (with `aria-activedescendant`) so the active option is always visible.
 */
export function ListBox({
  options,
  selected,
  onSelect,
  label,
  emptyText = 'Nothing to choose.'
}: {
  options: ListBoxOption[]
  selected: string | null
  onSelect: (value: string) => void
  label: string
  emptyText?: string
}) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  const enabledIndexes = useMemo(
    () =>
      options.reduce<number[]>((acc, o, i) => {
        if (!o.disabled) acc.push(i)
        return acc
      }, []),
    [options]
  )

  // Keep the active option on an enabled entry when options change.
  useEffect(() => {
    if (enabledIndexes.length === 0) return
    setIndex((i) => (enabledIndexes.includes(i) ? i : enabledIndexes[0]))
  }, [enabledIndexes])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const activeIndex = enabledIndexes.includes(index) ? index : (enabledIndexes[0] ?? -1)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (enabledIndexes.length === 0) return
    const pos = enabledIndexes.indexOf(activeIndex)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(enabledIndexes[(pos + 1) % enabledIndexes.length])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length])
    } else if (e.key === 'Home') {
      e.preventDefault()
      setIndex(enabledIndexes[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      setIndex(enabledIndexes[enabledIndexes.length - 1])
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[activeIndex]
      if (opt && !opt.disabled) onSelect(opt.value)
    }
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
      className="max-h-48 overflow-y-auto rounded border border-edge focus:border-accent focus:outline-none"
      onKeyDown={onKeyDown}
    >
      {options.length === 0 && (
        <div className="px-2 py-2 text-[11px] text-muted">{emptyText}</div>
      )}
      {options.map((o, i) => (
        <button
          key={o.value}
          id={`${baseId}-opt-${i}`}
          role="option"
          aria-selected={selected === o.value}
          aria-disabled={o.disabled || undefined}
          disabled={o.disabled}
          tabIndex={-1}
          data-active={i === activeIndex}
          className={`ww-menu-item ${
            selected === o.value
              ? 'bg-accent/15 text-accent'
              : i === activeIndex
                ? 'bg-panelalt'
                : ''
          }`}
          onMouseEnter={() => setIndex(i)}
          onClick={() => {
            if (!o.disabled) onSelect(o.value)
          }}
        >
          <span className="flex-1 truncate text-left">{o.label}</span>
          {o.note && <span className="shrink-0 text-[11px] text-muted">{o.note}</span>}
        </button>
      ))}
    </div>
  )
}
