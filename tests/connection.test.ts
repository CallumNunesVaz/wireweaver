import { describe, it, expect } from 'vitest'
import { findHarnessByEndpoint, planConnection } from '../src/model/connection'
import type { Harness, HarnessEndpoint, Project } from '../src/model/types'

const ep = (deviceInstanceId: string, portId: string): HarnessEndpoint => ({
  deviceInstanceId,
  portId
})

function projectWith(harnesses: Harness[]): Project {
  return {
    id: 'p1',
    name: 'Test',
    deviceInstances: [],
    harnesses,
    partSnapshots: {},
    templateSnapshots: {},
    revisions: []
  }
}

function harness(id: string, endpoints: HarnessEndpoint[]): Harness {
  return { id, name: `H${id}`, endpoints, wires: [], segments: [] }
}

describe('findHarnessByEndpoint', () => {
  it('finds the harness owning an endpoint', () => {
    const h = harness('h1', [ep('d1', 'p1'), ep('d2', 'p2')])
    expect(findHarnessByEndpoint([h], 'd2', 'p2')).toBe('h1')
    expect(findHarnessByEndpoint([h], 'd9', 'p2')).toBeUndefined()
  })
})

describe('planConnection', () => {
  it('creates a new harness when neither port is wired', () => {
    expect(planConnection(projectWith([]), ep('d1', 'p1'), ep('d2', 'p2'))).toEqual({
      kind: 'create'
    })
  })

  it('refuses a self-connection (same device instance)', () => {
    const plan = planConnection(projectWith([]), ep('d1', 'p1'), ep('d1', 'p2'))
    expect(plan.kind).toBe('error')
  })

  it('joins the existing harness when only the first port is wired', () => {
    const h = harness('h1', [ep('d1', 'p1'), ep('d2', 'p2')])
    const plan = planConnection(projectWith([h]), ep('d1', 'p1'), ep('d3', 'p3'))
    expect(plan).toEqual({ kind: 'join', harnessId: 'h1', endpoint: ep('d3', 'p3') })
  })

  it('joins the existing harness when only the second port is wired', () => {
    const h = harness('h1', [ep('d1', 'p1'), ep('d2', 'p2')])
    const plan = planConnection(projectWith([h]), ep('d3', 'p3'), ep('d2', 'p2'))
    expect(plan).toEqual({ kind: 'join', harnessId: 'h1', endpoint: ep('d3', 'p3') })
  })

  it('is a no-op when both ports already share a harness', () => {
    const h = harness('h1', [ep('d1', 'p1'), ep('d2', 'p2')])
    expect(planConnection(projectWith([h]), ep('d1', 'p1'), ep('d2', 'p2'))).toEqual({
      kind: 'noop'
    })
  })

  it('errors when the ports belong to different harnesses', () => {
    const h1 = harness('h1', [ep('d1', 'p1'), ep('d2', 'p2')])
    const h2 = harness('h2', [ep('d3', 'p3'), ep('d4', 'p4')])
    const plan = planConnection(projectWith([h1, h2]), ep('d1', 'p1'), ep('d3', 'p3'))
    expect(plan.kind).toBe('error')
    if (plan.kind === 'error') expect(plan.message).toMatch(/different harnesses/)
  })
})
