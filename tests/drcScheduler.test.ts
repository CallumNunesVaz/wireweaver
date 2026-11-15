import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runDrc } from '../src/model/drc'
import type { Project } from '../src/model/types'
import {
  DRC_DEBOUNCE_MS,
  DRC_SMALL_WIRES,
  setDrcWorkerFactory,
  requestDrc,
  useDrcSchedulerStore,
  type DrcWorkerFactory,
  type DrcWorkerHandle
} from '../src/stores/drcScheduler'
import { lib, project, clone } from './fixtures'

function largeProject(): Project {
  const wires = Array.from({ length: DRC_SMALL_WIRES }, (_, i) => ({
    id: `w${i}`,
    from: { end: 'a', position: i + 1 },
    to: { end: 'b', position: i + 1 }
  }))
  return {
    ...clone(project),
    harnesses: [
      {
        id: 'big',
        name: 'Big harness',
        endpoints: [],
        wires,
        segments: [],
        accessories: [],
        splices: []
      }
    ]
  }
}

let fake: DrcWorkerHandle
let created: number

function installFactory(): void {
  created = 0
  const factory: DrcWorkerFactory = () => {
    created += 1
    fake = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null
    }
    return fake
  }
  setDrcWorkerFactory(factory)
}

beforeEach(() => {
  vi.useFakeTimers()
  setDrcWorkerFactory(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('drcScheduler', () => {
  it('checks small projects synchronously and never touches the worker', () => {
    installFactory()
    requestDrc(lib, project)
    expect(useDrcSchedulerStore.getState().issues).toEqual(runDrc(lib, project))
    expect(useDrcSchedulerStore.getState().pending).toBe(false)
    expect(created).toBe(0)
  })

  it('debounces bursts of large-project requests into one dispatch', () => {
    installFactory()
    const big = largeProject()
    requestDrc(lib, big)
    requestDrc(lib, big)
    requestDrc(lib, big)

    expect(useDrcSchedulerStore.getState().pending).toBe(true)
    expect(created).toBe(0)

    vi.advanceTimersByTime(DRC_DEBOUNCE_MS)

    expect(fake.postMessage).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(fake.postMessage).mock.calls[0][0]
    expect(sent.id).toBe(3)
  })

  it('ignores out-of-order responses by request id', () => {
    installFactory()
    const big = largeProject()
    requestDrc(lib, big)
    vi.advanceTimersByTime(DRC_DEBOUNCE_MS)
    expect(fake.postMessage).toHaveBeenCalledTimes(1)

    requestDrc(lib, big)
    const stale = [{ severity: 'warning' as const, message: 'STALE' }]
    fake.onmessage?.({ data: { id: 1, issues: stale } })

    expect(useDrcSchedulerStore.getState().issues).toEqual([])
    expect(useDrcSchedulerStore.getState().pending).toBe(true)

    vi.advanceTimersByTime(DRC_DEBOUNCE_MS)
    expect(fake.postMessage).toHaveBeenCalledTimes(2)

    fake.onmessage?.({ data: { id: 2, issues: runDrc(lib, big) } })
    expect(useDrcSchedulerStore.getState().issues).toEqual(runDrc(lib, big))
    expect(useDrcSchedulerStore.getState().pending).toBe(false)
  })

  it('falls back to synchronous runDrc when no Worker is available', () => {
    const big = largeProject()
    requestDrc(lib, big)
    expect(useDrcSchedulerStore.getState().issues).toEqual(runDrc(lib, big))
    expect(useDrcSchedulerStore.getState().pending).toBe(false)
  })

  it('falls back to synchronous runDrc when the worker errors', () => {
    installFactory()
    const big = largeProject()
    requestDrc(lib, big)
    vi.advanceTimersByTime(DRC_DEBOUNCE_MS)
    expect(created).toBe(1)

    fake.onmessage?.({ data: { id: 1, error: 'boom' } })

    expect(fake.terminate).toHaveBeenCalled()
    expect(useDrcSchedulerStore.getState().issues).toEqual(runDrc(lib, big))
    expect(useDrcSchedulerStore.getState().pending).toBe(false)

    // Once failed, subsequent requests stay synchronous.
    requestDrc(lib, big)
    expect(created).toBe(1)
    expect(useDrcSchedulerStore.getState().issues).toEqual(runDrc(lib, big))
  })
})
