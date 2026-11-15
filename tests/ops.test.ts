import { describe, it, expect } from 'vitest'
import * as ops from '../src/model/ops'
import { project } from './fixtures'
import type {
  Harness,
  HarnessAccessory,
  HarnessEndpoint,
  HarnessWire,
  Project
} from '../src/model/types'

function baseProject(): Project {
  return {
    id: 'p1',
    name: 'Test',
    deviceInstances: [
      { id: 'i1', partId: 'd1', label: 'A', position: { x: 0, y: 0 } },
      { id: 'i2', partId: 'd2', label: 'B', position: { x: 100, y: 0 } },
      { id: 'i3', partId: 'd3', label: 'C', position: { x: 200, y: 0 } }
    ],
    harnesses: [],
    partSnapshots: {},
    templateSnapshots: {},
    revisions: []
  }
}

function ep(deviceInstanceId: string, portId: string): HarnessEndpoint {
  return { deviceInstanceId, portId }
}

function wire(id: string, from: string, fromPos: number, to: string, toPos: number, extra: Partial<HarnessWire> = {}): HarnessWire {
  return { id, from: { end: from, position: fromPos }, to: { end: to, position: toPos }, ...extra }
}

function harness(id: string, endpoints: HarnessEndpoint[], extra: Partial<Harness> = {}): Harness {
  return { id, name: id, endpoints, wires: [], segments: [], accessories: [], splices: [], ...extra }
}

/** Run `fn` against `project` and assert the input is untouched (deep-equal). */
function runImmutably<T>(project: Project, fn: (p: Project) => T): T {
  const before = structuredClone(project)
  const result = fn(project)
  expect(project).toEqual(before)
  return result
}

describe('ops — device instances', () => {
  it('adds an instance immutably and returns its id', () => {
    const p = baseProject()
    const r = runImmutably(p, (x) => ops.addInstance(x, 'd1', { x: 5, y: 6 }, 'New'))
    expect(r.id).toBeTruthy()
    expect(r.project.deviceInstances).toHaveLength(4)
    expect(r.project.deviceInstances[3]).toMatchObject({ partId: 'd1', label: 'New', position: { x: 5, y: 6 } })
    expect(r.project).not.toBe(p)
  })

  it('moves an instance and returns the same project for an unknown id', () => {
    const p = baseProject()
    const moved = runImmutably(p, (x) => ops.updateInstancePosition(x, 'i1', { x: 9, y: 9 }))
    expect(moved.deviceInstances.find((d) => d.id === 'i1')!.position).toEqual({ x: 9, y: 9 })
    expect(ops.updateInstancePosition(p, 'nope', { x: 0, y: 0 })).toBe(p)
  })

  it('bulk-moves many instances in one call', () => {
    const p = baseProject()
    const moved = runImmutably(p, (x) =>
      ops.updateInstancePositions(x, [
        { id: 'i1', position: { x: 1, y: 1 } },
        { id: 'i2', position: { x: 2, y: 2 } }
      ])
    )
    expect(moved.deviceInstances.find((d) => d.id === 'i1')!.position).toEqual({ x: 1, y: 1 })
    expect(moved.deviceInstances.find((d) => d.id === 'i2')!.position).toEqual({ x: 2, y: 2 })
    expect(ops.updateInstancePositions(p, [])).toBe(p)
  })

  it('renames an instance label', () => {
    const p = baseProject()
    const next = runImmutably(p, (x) => ops.setInstanceLabel(x, 'i1', 'Renamed'))
    expect(next.deviceInstances.find((d) => d.id === 'i1')!.label).toBe('Renamed')
  })

  it('removes many instances, pruning harnesses', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA'), ep('i3', 'pA')])]
    const next = runImmutably(p, (x) => ops.removeInstances(x, ['i1']))
    expect(next.deviceInstances.map((d) => d.id)).toEqual(['i2', 'i3'])
    expect(next.harnesses[0].endpoints).toEqual([ep('i2', 'pA'), ep('i3', 'pA')])
  })

  it('drops a harness left with fewer than two endpoints', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const next = ops.removeInstances(p, ['i1'])
    expect(next.harnesses).toHaveLength(0)
  })

  it('duplicates an instance with an offset and copy label', () => {
    const p = baseProject()
    const next = runImmutably(p, (x) => ops.duplicateInstance(x, 'i1'))
    expect(next.deviceInstances).toHaveLength(4)
    const copy = next.deviceInstances.find((d) => d.id !== 'i1' && d.label === 'A copy')!
    expect(copy.position).toEqual({ x: 40, y: 40 })
    expect(ops.duplicateInstance(p, 'nope')).toBe(p)
  })
})

describe('ops — harnesses', () => {
  it('adds a harness and auto-names it from instance labels', () => {
    const p = baseProject()
    const r = runImmutably(p, (x) => ops.addHarness(x, [ep('i1', 'pA'), ep('i2', 'pA')])!)
    expect(r.id).toBeTruthy()
    expect(r.project.harnesses[0].name).toBe('A–B')
    expect(r.project.harnesses[0].endpoints).toHaveLength(2)
  })

  it('returns undefined for fewer than two endpoints', () => {
    expect(ops.addHarness(baseProject(), [ep('i1', 'pA')])).toBeUndefined()
  })

  it('joins an existing harness when an endpoint already belongs to one', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const r = runImmutably(p, (x) => ops.addHarness(x, [ep('i1', 'pA'), ep('i3', 'pA')])!)
    expect(r.id).toBe('h1')
    expect(r.project.harnesses).toHaveLength(1)
    expect(r.project.harnesses[0].endpoints).toEqual([ep('i1', 'pA'), ep('i2', 'pA'), ep('i3', 'pA')])
  })

  it('imports a harness under a new id, remapping splice and accessory ids', () => {
    const p = baseProject()
    const src: Harness = harness('src', [ep('i1', 'pA'), ep('i2', 'pA')], {
      wires: [wire('w', 'a', 1, 'b', 1)],
      splices: [{ id: 'sp', name: 'S1', wireIds: ['w'] }],
      accessories: [{ id: 'acc', partId: 'x', category: 'loom', quantity: 1 }]
    })
    const r = runImmutably(p, (x) => ops.importHarness(x, src))
    expect(r.id).not.toBe('src')
    const got = r.project.harnesses[0]
    expect(got.id).toBe(r.id)
    expect(got.splices![0].id).not.toBe('sp')
    expect(got.accessories![0].id).not.toBe('acc')
  })

  it('adds an endpoint and rejects duplicates', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const added = runImmutably(p, (x) => ops.addEndpoint(x, 'h1', ep('i3', 'pA')))
    expect(added.added).toBe(true)
    expect(added.project.harnesses[0].endpoints).toHaveLength(3)
    expect(ops.addEndpoint(p, 'h1', ep('i1', 'pA')).added).toBe(false)
    expect(ops.addEndpoint(p, 'nope', ep('i3', 'pA')).added).toBe(false)
  })

  it('removes an endpoint and remaps surviving wires and segments', () => {
    const p = baseProject()
    p.harnesses = [
      harness('h1', [ep('i1', 'pA'), ep('i2', 'pA'), ep('i3', 'pA')], {
        wires: [
          wire('w1', 'a', 1, 'b', 1),
          wire('w2', 'b', 1, 'c', 1)
        ],
        segments: [{ fromEnd: 'b', toEnd: 'c', lengthMm: 10 }]
      })
    ]
    const next = runImmutably(p, (x) => ops.removeEndpoint(x, 'h1', 'a'))
    const h = next.harnesses[0]
    expect(h.endpoints).toEqual([ep('i2', 'pA'), ep('i3', 'pA')])
    // w1 touched removed 'a' and is dropped; w2's b->a and c->b.
    expect(h.wires).toEqual([wire('w2', 'a', 1, 'b', 1)])
    expect(h.segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 10 }])
  })

  it('updates a harness patch', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const next = runImmutably(p, (x) => ops.updateHarness(x, 'h1', { name: 'X', description: 'd' }))
    expect(next.harnesses[0]).toMatchObject({ name: 'X', description: 'd' })
    expect(ops.updateHarness(p, 'nope', { name: 'X' })).toBe(p)
  })

  it('sets wires and sanitises dangling twists', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const next = runImmutably(p, (x) =>
      ops.setWires(x, 'h1', [
        wire('w1', 'a', 1, 'b', 1, { twistedWith: 'ghost' }),
        wire('w2', 'a', 2, 'b', 2)
      ])
    )
    expect(next.harnesses[0].wires[0].twistedWith).toBeUndefined()
  })

  it('upserts a segment by (fromEnd, toEnd)', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    let next = ops.upsertSegment(p, 'h1', 'a', 'b', { lengthMm: 100 })
    expect(next.harnesses[0].segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 100 }])
    next = ops.upsertSegment(next, 'h1', 'a', 'b', { lengthMm: 200, label: 'X' })
    expect(next.harnesses[0].segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 200, label: 'X' }])
  })

  it('removes a harness', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    expect(ops.removeHarness(p, 'h1').harnesses).toHaveLength(0)
    expect(ops.removeHarness(p, 'nope')).toBe(p)
  })

  it('duplicates a harness remapping wire ids, twists, splice wireIds and accessory ids', () => {
    const p = baseProject()
    p.harnesses = [
      harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')], {
        wires: [
          wire('w1', 'a', 1, 'b', 1, { twistedWith: 'w2' }),
          wire('w2', 'a', 2, 'b', 2, { twistedWith: 'w1' })
        ],
        splices: [{ id: 'sp1', name: 'S1', wireIds: ['w1', 'w2'] }],
        accessories: [{ id: 'acc1', partId: 'x', category: 'contact', quantity: 1 }]
      })
    ]
    const next = runImmutably(p, (x) => ops.duplicateHarness(x, 'h1'))
    const copy = next.harnesses.find((h) => h.id !== 'h1')!
    expect(copy.name).toBe('h1 copy')
    const ids = copy.wires.map((w) => w.id)
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain('w1')
    expect(ids).not.toContain('w2')
    expect(copy.wires[0].twistedWith).toBe(ids[1])
    expect(copy.wires[1].twistedWith).toBe(ids[0])
    expect(copy.splices![0].id).not.toBe('sp1')
    expect(copy.splices![0].wireIds.sort()).toEqual([...ids].sort())
    expect(copy.accessories![0].id).not.toBe('acc1')
    expect(ops.duplicateHarness(p, 'nope')).toBe(p)
  })
})

describe('ops — accessories and splices', () => {
  it('adds and removes accessories', () => {
    const p = baseProject()
    p.harnesses = [harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')])]
    const acc: Omit<HarnessAccessory, 'id'> = { partId: 'x', category: 'seal', quantity: 3 }
    const added = runImmutably(p, (x) => ops.addHarnessAccessory(x, 'h1', acc))
    expect(added.id).toBeTruthy()
    expect(added.project.harnesses[0].accessories).toHaveLength(1)
    const removed = ops.removeHarnessAccessory(added.project, 'h1', added.id)
    expect(removed.harnesses[0].accessories).toHaveLength(0)
  })

  it('adds, moves, assigns and removes splices', () => {
    const p = baseProject()
    p.harnesses = [
      harness('h1', [ep('i1', 'pA'), ep('i2', 'pA')], {
        wires: [wire('w1', 'a', 1, 'b', 1), wire('w2', 'a', 2, 'b', 2)]
      })
    ]
    const added = runImmutably(p, (x) => ops.addSplice(x, 'h1', ['w1', 'w2']))
    expect(added.project.harnesses[0].splices![0].name).toBe('Splice 1')

    const moved = ops.moveSplice(added.project, 'h1', added.id, { x: 3, y: 4 })
    expect(moved.harnesses[0].splices![0].position).toEqual({ x: 3, y: 4 })

    const assigned = ops.assignSpliceWire(moved, 'h1', added.id, 'wire-part')
    expect(assigned.found).toBe(true)
    expect(assigned.project.harnesses[0].splices![0].wirePartId).toBe('wire-part')

    const removed = ops.removeSplice(assigned.project, 'h1', added.id)
    expect(removed.harnesses[0].splices).toHaveLength(0)
  })
})

describe('ops — revisions and meta', () => {
  it('adds and restores revisions', () => {
    const p = baseProject()
    const added = runImmutably(p, (x) => ops.addRevision(x, 'R1', 'desc'))
    expect(added.revision.label).toBe('R1')
    expect(added.project.revisions).toHaveLength(1)

    const renamed = ops.setProjectMeta(added.project, { name: 'After' })
    const restored = ops.restoreRevision(renamed, added.revision.id)
    expect(restored.name).toBe('Test')
    expect(restored.revisions).toHaveLength(1)
  })

  it('sets project metadata immutably', () => {
    const p = baseProject()
    const next = runImmutably(p, (x) => ops.setProjectMeta(x, { name: 'N', author: 'Ada' }))
    expect(next).toMatchObject({ name: 'N', author: 'Ada' })
    expect(ops.setProjectMeta(p, {})).toBe(p)
  })
})

describe('review fixes on top of ops', () => {
  it('api.addEndpoint refuses a port that already belongs to another harness', async () => {
    const api = await import('../src/model/api')
    const ws = api.loadWorkspace({
      ...JSON.parse(JSON.stringify(project)),
      harnesses: [
        { ...JSON.parse(JSON.stringify(project.harnesses[0])), id: 'h1' },
        { id: 'h2', name: 'Other', endpoints: [], wires: [], segments: [] }
      ]
    })
    expect(() => api.addEndpoint(ws, 'h2', { deviceInstanceId: 'i1', portId: 'portA' })).toThrow(
      /already belongs to harness "FC1-FC2"/
    )
  })

  it('a no-op store action does not mark the project dirty', async () => {
    const { useProjectStore } = await import('../src/stores/projectStore')
    useProjectStore.getState().loadProject(JSON.parse(JSON.stringify(project)))
    expect(useProjectStore.getState().dirty).toBe(false)
    useProjectStore.getState().removeHarness('does-not-exist')
    useProjectStore.getState().setInstanceLabel('nope', 'x')
    expect(useProjectStore.getState().dirty).toBe(false)
    useProjectStore.getState().removeHarness('h1')
    expect(useProjectStore.getState().dirty).toBe(true)
  })
})
