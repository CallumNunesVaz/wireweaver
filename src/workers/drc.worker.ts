import { runDrc } from '../model/drc'
import type { DrcIssue } from '../model/drc'
import type { LibraryLike } from '../model/derivation'
import type { Project } from '../model/types'

export interface DrcRequestMessage {
  id: number
  lib: LibraryLike
  project: Project
}

export interface DrcResponseMessage {
  id: number
  issues?: DrcIssue[]
  error?: string
}

interface DrcWorkerScope {
  onmessage: ((event: MessageEvent<DrcRequestMessage>) => void) | null
  postMessage(message: DrcResponseMessage): void
}

const scope = self as unknown as DrcWorkerScope

scope.onmessage = (event) => {
  const { id, lib, project } = event.data
  try {
    const issues = runDrc(lib, project)
    scope.postMessage({ id, issues })
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
