/**
 * Off-main-thread design-rule check. `runDrc` can block typing and dragging on
 * large projects, so the check is handed to a Web Worker and this module
 * debounces, orders and de-duplicates the requests.
 *
 * The result is "stale-while-revalidate": subscribers always read the last
 * good result (kept while a new one is computing) and see a `pending` flag
 * while work is in flight. Small projects, missing Worker support and worker
 * failures all fall back to a synchronous `runDrc` on the main thread.
 */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { runDrc, type DrcIssue } from '../model/drc'
import type { LibraryLike } from '../model/derivation'
import type { Project } from '../model/types'
import type { DrcRequestMessage, DrcResponseMessage } from '../workers/drc.worker'

/** A minimal view of a `Worker` plus the fields the scheduler drives. */
export interface DrcWorkerHandle {
  postMessage(message: DrcRequestMessage): void
  terminate(): void
  onmessage: ((event: { data: DrcResponseMessage }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export type DrcWorkerFactory = () => DrcWorkerHandle

export const DRC_DEBOUNCE_MS = 150
/**
 * Below this many total wires the structured-clone + worker round-trip costs
 * more than the check itself (a handful of milliseconds), so we stay on the
 * main thread and keep the check synchronous.
 */
export const DRC_SMALL_WIRES = 300

interface DrcSchedulerState {
  issues: DrcIssue[]
  pending: boolean
}

export const useDrcSchedulerStore = create<DrcSchedulerState>(() => ({
  issues: [],
  pending: false
}))

let workerFactory: DrcWorkerFactory | null = null
let worker: DrcWorkerHandle | null = null
let workerFailed = false
let refCount = 0
let nextId = 0
let latestId = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let latestInput: { lib: LibraryLike; project: Project } | null = null

/** Swap the worker factory (tests inject a fake here). Null resets to default. */
export function setDrcWorkerFactory(factory: DrcWorkerFactory | null): void {
  disposeWorker()
  workerFactory = factory
  workerFailed = false
  nextId = 0
  latestId = 0
  latestInput = null
  requestedInput = null
  syncCache = null
  useDrcSchedulerStore.setState({ issues: [], pending: false })
}

function disposeWorker(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (worker) {
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
  }
}

/** Reference-counted so the worker can be torn down once nothing uses it. */
export function retainDrcWorker(): () => void {
  refCount += 1
  return () => {
    refCount -= 1
    if (refCount <= 0) {
      refCount = 0
      disposeWorker()
      useDrcSchedulerStore.setState({ pending: false })
    }
  }
}

function totalWires(project: Project): number {
  return project.harnesses.reduce((n, h) => n + h.wires.length, 0)
}

function defaultWorkerFactory(): DrcWorkerHandle {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not available in this environment')
  }
  return new Worker(new URL('../workers/drc.worker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as DrcWorkerHandle
}

function workerAvailable(): boolean {
  if (workerFailed) return false
  if (workerFactory) return true
  return typeof Worker !== 'undefined'
}

function getWorker(): DrcWorkerHandle | null {
  if (workerFailed) return null
  if (worker) return worker
  const factory = workerFactory ?? defaultWorkerFactory
  try {
    worker = factory()
    worker.onmessage = (event) => handleMessage(event.data)
    worker.onerror = () => handleWorkerError()
    return worker
  } catch {
    return null
  }
}

function shouldRunSync(project: Project): boolean {
  if (totalWires(project) < DRC_SMALL_WIRES) return true
  return !workerAvailable()
}

function handleMessage(data: DrcResponseMessage): void {
  if (data.id !== latestId) return
  if (data.error !== undefined) {
    handleWorkerError()
    return
  }
  const issues = data.issues ?? []
  useDrcSchedulerStore.setState({ issues, pending: false })
}

function handleWorkerError(): void {
  workerFailed = true
  disposeWorker()
  const input = latestInput
  if (input) {
    const issues = runDrc(input.lib, input.project)
    useDrcSchedulerStore.setState({ issues, pending: false })
  } else {
    useDrcSchedulerStore.setState({ pending: false })
  }
}

function dispatch(id: number, lib: LibraryLike, project: Project): void {
  if (id !== latestId) return
  const w = getWorker()
  if (!w) {
    const issues = runDrc(lib, project)
    useDrcSchedulerStore.setState({ issues, pending: false })
    return
  }
  w.postMessage({ id, lib, project })
}

/** Schedule (or, for small projects, immediately run) a DRC pass. */
export function requestDrc(lib: LibraryLike, project: Project): void {
  const id = ++nextId
  latestId = id
  latestInput = { lib, project }

  if (shouldRunSync(project)) {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const issues = runDrc(lib, project)
    useDrcSchedulerStore.setState({ issues, pending: false })
    return
  }

  useDrcSchedulerStore.setState({ pending: true })
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    dispatch(id, lib, project)
  }, DRC_DEBOUNCE_MS)
}

let syncCache: { lib: LibraryLike; project: Project; issues: DrcIssue[] } | null = null

/** Synchronous check, shared by every subscriber for the same inputs. */
function runDrcCached(lib: LibraryLike, project: Project): DrcIssue[] {
  if (syncCache && syncCache.lib === lib && syncCache.project === project) return syncCache.issues
  const issues = runDrc(lib, project)
  syncCache = { lib, project, issues }
  return issues
}

/** The input most recently handed to requestDrc, to de-duplicate subscribers. */
let requestedInput: { lib: LibraryLike; project: Project } | null = null

/**
 * React hook: synchronous result for small/no-worker projects, otherwise the
 * last known result while a worker pass is debounced and computed.
 */
export function useDrc(lib: LibraryLike, project: Project): DrcIssue[] {
  const issues = useDrcSchedulerStore((s) => s.issues)
  const sync = shouldRunSync(project)
  const syncIssues = useMemo(() => (sync ? runDrcCached(lib, project) : null), [lib, project, sync])

  // Hold the worker for the subscriber's lifetime — not per input change, or
  // every edit would terminate and recreate it (and drop the pending pass).
  useEffect(() => retainDrcWorker(), [])

  useEffect(() => {
    if (sync) {
      useDrcSchedulerStore.setState({ pending: false })
      return
    }
    // Several subscribers (badge, panel) see the same input; request once.
    if (requestedInput && requestedInput.lib === lib && requestedInput.project === project) return
    requestedInput = { lib, project }
    requestDrc(lib, project)
  }, [lib, project, sync])

  return sync ? (syncIssues as DrcIssue[]) : issues
}

export function useDrcPending(): boolean {
  return useDrcSchedulerStore((s) => s.pending)
}
