import { describe, it, expect } from 'vitest'
import { runDrc } from '../src/model/drc'
import type { Harness, Project } from '../src/model/types'
import { lib, project, harness, clone } from './fixtures'

function projectWith(harnesses: Harness[]): Project {
  return { ...clone(project), harnesses }
}

describe('runDrc project rules', () => {
  it('errors when one port belongs to two different harnesses', () => {
    const h2: Harness = {
      id: 'h2',
      name: 'H2',
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'i3', portId: 'portA' }
      ],
      wires: [],
      segments: []
    }
    const issues = runDrc(lib, projectWith([harness, h2]))
    const shared = issues.find((i) => i.message.includes('more than one harness'))
    expect(shared).toBeDefined()
    expect(shared!.severity).toBe('error')
  })

  it('warns about unresolved endpoints while still resolving the rest', () => {
    const three: Harness = {
      ...clone(harness),
      endpoints: [
        { deviceInstanceId: 'i1', portId: 'portA' },
        { deviceInstanceId: 'i2', portId: 'portA' },
        { deviceInstanceId: 'missing', portId: 'portA' }
      ]
    }
    const issues = runDrc(lib, projectWith([three]))
    const unresolved = issues.find((i) => i.message.includes('Unresolved endpoint'))
    expect(unresolved).toBeDefined()
    expect(unresolved!.severity).toBe('warning')
  })

  it('surfaces splice validation warnings', () => {
    const bad: Harness = {
      ...clone(harness),
      splices: [{ id: 's1', name: 'S1', wireIds: ['w1'] }]
    }
    const issues = runDrc(lib, projectWith([bad]))
    expect(issues.some((i) => i.message.includes('fewer than 2 wires'))).toBe(true)
  })

  it('sorts errors before warnings', () => {
    const broken: Project = {
      ...projectWith([clone(harness)]),
      deviceInstances: [
        ...clone(project).deviceInstances,
        { id: 'ghost', partId: 'missing', label: 'Ghost', position: { x: 0, y: 0 } }
      ]
    }
    const issues = runDrc(lib, broken)
    expect(issues.length).toBeGreaterThan(1)
    expect(issues[0].severity).toBe('error')
  })
})
