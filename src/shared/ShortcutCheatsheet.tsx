import { Modal } from './Modal'

interface ShortcutRow {
  keys: string[]
  action: string
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['Ctrl+S'], action: 'Save project' },
  { keys: ['Ctrl+Shift+S'], action: 'Save As' },
  { keys: ['Ctrl+O'], action: 'Open project' },
  { keys: ['Ctrl+N'], action: 'New project' },
  { keys: ['Ctrl+K'], action: 'Command palette' },
  { keys: ['Ctrl+B'], action: 'Export BOM (CSV)' },
  { keys: ['Ctrl+R'], action: 'Reports & exports' },
  { keys: ['Ctrl+E'], action: 'Edit selected harness' },
  { keys: ['Ctrl+H'], action: 'Toggle library sidebar' },
  { keys: ['Ctrl+Z'], action: 'Undo (in a text field: undo typing)' },
  { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], action: 'Redo' },
  { keys: ['Ctrl+F'], action: 'Focus library search' },
  { keys: ['Ctrl+D'], action: 'Duplicate selected device' },
  { keys: ['Ctrl+L'], action: 'Library Manager' },
  { keys: ['F2'], action: 'Rename selected device/harness' },
  { keys: ['C'], action: 'Connect ports (with a device selected)' },
  { keys: ['W'], action: 'Add wire (in the Harness Editor)' },
  { keys: ['Delete', 'Backspace'], action: 'Delete selected' },
  { keys: ['Ctrl+click'], action: 'Add a device (or wire) to the selection' },
  { keys: ['Alt+drag'], action: 'Duplicate device while dragging' },
  { keys: ['Arrow keys'], action: 'Nudge selected devices (1px)' },
  { keys: ['Shift+Arrow'], action: 'Nudge 10px' },
  { keys: ['Escape'], action: 'Close the top-most dialog or popup' },
  { keys: ['F1'], action: 'Open documentation' },
  { keys: ['?'], action: 'Show this cheatsheet' }
]

export function ShortcutCheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border-b border-edge px-2 py-1 text-left font-semibold text-muted">Shortcut</th>
            <th className="border-b border-edge px-2 py-1 text-left font-semibold text-muted">Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((row, i) => (
            <tr key={i} className="border-b border-edge/30">
              <td className="px-2 py-1.5">
                <div className="flex flex-wrap gap-1">
                  {row.keys.map((k) => (
                    <kbd key={k} className="rounded bg-panelalt border border-edge px-1.5 py-0.5 font-mono text-[11px]">
                      {k}
                    </kbd>
                  ))}
                </div>
              </td>
              <td className="px-2 py-1.5">{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
