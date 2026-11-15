import { useCallback, useEffect, useRef } from 'react'
import type { NodeChange } from '@xyflow/react'

export interface NodeMove {
  id: string
  position: { x: number; y: number }
}

/**
 * Wrap React Flow's `onNodesChange` so in-flight drag frames are batched to one
 * update per animation frame, while everything else (selection, removal,
 * drag end) applies immediately. Drag-end positions are reported once per
 * gesture as a batch so callers can commit them as a single undo step.
 */
export function useRafNodeChanges(
  applyLocal: (changes: NodeChange[]) => void,
  onCommit: (moves: NodeMove[]) => void,
  onRemove?: (ids: string[]) => void
): (changes: NodeChange[]) => void {
  const pending = useRef<NodeChange[]>([])
  const raf = useRef(0)
  const commitRef = useRef(onCommit)
  const removeRef = useRef(onRemove)
  commitRef.current = onCommit
  removeRef.current = onRemove

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return useCallback(
    (changes: NodeChange[]) => {
      const dragging: NodeChange[] = []
      const immediate: NodeChange[] = []
      for (const c of changes) {
        if (c.type === 'position' && c.dragging) dragging.push(c)
        else immediate.push(c)
      }

      if (immediate.length > 0) {
        // Flush any queued frame first so the final position wins.
        if (raf.current) {
          cancelAnimationFrame(raf.current)
          raf.current = 0
          applyLocal(pending.current)
          pending.current = []
        }
        applyLocal(immediate)
        const moves: NodeMove[] = []
        const removed: string[] = []
        for (const c of immediate) {
          if (c.type === 'position' && c.position) moves.push({ id: c.id, position: c.position })
          else if (c.type === 'remove') removed.push(c.id)
        }
        if (moves.length) commitRef.current(moves)
        if (removed.length) removeRef.current?.(removed)
      }

      if (dragging.length > 0) {
        pending.current.push(...dragging)
        if (raf.current === 0) {
          raf.current = requestAnimationFrame(() => {
            raf.current = 0
            const batch = pending.current
            pending.current = []
            applyLocal(batch)
          })
        }
      }
    },
    [applyLocal]
  )
}
