import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { projectForDisk } from './projectActions'

const AUTOSAVE_MS = 3000

/**
 * Side effects that follow the project without re-rendering the app shell:
 * the main-process dirty flag (close prompt), the native window title, and
 * the rolling crash-recovery autosave.
 */
export function ProjectWatcher() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastDirty: boolean | null = null

    const sync = (s = useProjectStore.getState()) => {
      if (s.dirty !== lastDirty) {
        lastDirty = s.dirty
        window.ww.project.setDirty(s.dirty).catch(() => {})
      }
      document.title = `${s.dirty ? '• ' : ''}${s.project.name} — WireWeaver`
    }
    sync()

    const unsub = useProjectStore.subscribe((s, prev) => {
      sync(s)
      if (!s.dirty || s.project === prev.project) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const st = useProjectStore.getState()
        if (!st.dirty) return
        window.ww.project.autosave(projectForDisk(), st.filePath).catch(() => {})
      }, AUTOSAVE_MS)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return null
}
