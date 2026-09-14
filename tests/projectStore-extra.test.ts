import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '../src/stores/projectStore'
import type {
  Harness,
  HarnessEndpoint,
  HarnessWire,
  Project
} from '../src/model/types'

const emptyProject: Project = {
  id: 'p1',
  name: 'Untitled',
  deviceInstances: [],
  harnesses: [],
  partSnapshots: {},
  templateSnapshots: {},
  revisions: []
}

function reset(): void {
  useProjectStore.setState({
    project: structuredClone(emptyProject),
    filePath: undefined,
    dirty: false
  })
  useProjectStore.temporal.getState().clear()
}

function inst(id: string) {
  return useProjectStore.getState().project.deviceInstances.find((i) => i.id === id)!
}

function harnessById(id: string): Harness {
  return useProjectStore.getState().project.harnesses.find((h) => h.id === id)!
}

/** Two placed devices and a two-endpoint harness between them. */
function seedHarness(): { a: string; b: string; hid: string } {
  const s = useProjectStore.getState()
  const a = s.addInstance('devA', { x: 0, y: 0 }, 'A')
  const b = s.addInstance('devB', { x: 100, y: 0 }, 'B')
  const ep1: HarnessEndpoint = { deviceInstanceId: a, portId: 'pA' }
  const ep2: HarnessEndpoint = { deviceInstanceId: b, portId: 'pB' }
  const hid = s.addHarness([ep1, ep2])!
  return { a, b, hid }
}

describe('projectStore extras', () => {
  beforeEach(reset)

  it('bulk-updates instance positions', () => {
    const { a, b } = seedHarness()
    useProjectStore.getState().updateInstancePositions([
      { id: a, position: { x: 5, y: 5 } },
      { id: b, position: { x: 6, y: 6 } }
    ])
    expect(inst(a).position).toEqual({ x: 5, y: 5 })
    expect(inst(b).position).toEqual({ x: 6, y: 6 })
  })

  it('renames an instance label', () => {
    const { a } = seedHarness()
    useProjectStore.getState().setInstanceLabel(a, 'Renamed')
    expect(inst(a).label).toBe('Renamed')
  })

  it('duplicates an instance offset and marked as a copy', () => {
    const { a } = seedHarness()
    useProjectStore.getState().duplicateInstance(a)
    const list = useProjectStore.getState().project.deviceInstances
    expect(list).toHaveLength(3)
    const copy = list.find((i) => i.id !== a && i.label === 'A copy')!
    expect(copy.position).toEqual({ x: 40, y: 40 })
  })

  it('imports a fully-formed harness under a new id', () => {
    const { a, b } = seedHarness()
    const source: Harness = {
      id: 'source',
      name: 'Imported',
      endpoints: [
        { deviceInstanceId: a, portId: 'pA' },
        { deviceInstanceId: b, portId: 'pB' }
      ],
      wires: [{ id: 'w', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } }],
      segments: [{ fromEnd: 'a', toEnd: 'b', lengthMm: 10 }]
    }
    const id = useProjectStore.getState().importHarness(source)
    expect(id).not.toBe('source')
    const got = harnessById(id)
    expect(got.name).toBe('Imported')
    expect(got.wires).toHaveLength(1)
  })

  it('duplicates a harness, remapping wire ids, twists, splices and accessories', () => {
    const { hid } = seedHarness()
    const w1: HarnessWire = {
      id: 'w1',
      from: { end: 'a', position: 1 },
      to: { end: 'b', position: 1 },
      twistedWith: 'w2'
    }
    const w2: HarnessWire = {
      id: 'w2',
      from: { end: 'a', position: 2 },
      to: { end: 'b', position: 2 },
      twistedWith: 'w1'
    }
    useProjectStore.getState().setHarnessWires(hid, [w1, w2])
    useProjectStore.getState().addSplice(hid, ['w1', 'w2'])
    useProjectStore.getState().addHarnessAccessory(hid, {
      partId: 'acc1',
      category: 'contact',
      quantity: 1
    })

    useProjectStore.getState().duplicateHarness(hid)

    const copy = useProjectStore.getState().project.harnesses.find((h) => h.id !== hid)!
    const ids = copy.wires.map((w) => w.id)
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain('w1')
    expect(copy.wires[0].twistedWith).toBe(ids[1])
    expect(copy.wires[1].twistedWith).toBe(ids[0])
    expect(copy.splices![0].wireIds.sort()).toEqual([...ids].sort())
    expect(copy.accessories![0].id).toBeTruthy()
  })

  it('adds and removes accessories', () => {
    const { hid } = seedHarness()
    useProjectStore.getState().addHarnessAccessory(hid, {
      partId: 'acc',
      category: 'seal',
      quantity: 3
    })
    const acc = harnessById(hid).accessories![0]
    expect(acc.quantity).toBe(3)
    useProjectStore.getState().removeHarnessAccessory(hid, acc.id)
    expect(harnessById(hid).accessories).toHaveLength(0)
  })

  it('adds, assigns and removes splices', () => {
    const { hid } = seedHarness()
    useProjectStore.getState().setHarnessWires(hid, [
      { id: 'w1', from: { end: 'a', position: 1 }, to: { end: 'b', position: 1 } },
      { id: 'w2', from: { end: 'a', position: 2 }, to: { end: 'b', position: 2 } }
    ])
    useProjectStore.getState().addSplice(hid, ['w1', 'w2'])
    const splice = harnessById(hid).splices![0]
    expect(splice.wireIds).toEqual(['w1', 'w2'])

    useProjectStore.getState().assignSpliceWire(hid, splice.id, 'wire-part')
    expect(harnessById(hid).splices![0].wirePartId).toBe('wire-part')

    useProjectStore.getState().removeSplice(hid, splice.id)
    expect(harnessById(hid).splices).toHaveLength(0)
  })

  it('adds and updates a segment length', () => {
    const { hid } = seedHarness()
    useProjectStore.getState().setHarnessSegment(hid, 'a', 'b', { lengthMm: 100 })
    expect(harnessById(hid).segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 100 }])
    useProjectStore.getState().setHarnessSegment(hid, 'a', 'b', { lengthMm: 200, label: 'X' })
    expect(harnessById(hid).segments).toEqual([
      { fromEnd: 'a', toEnd: 'b', lengthMm: 200, label: 'X' }
    ])
  })

  it('updates project metadata', () => {
    useProjectStore.getState().setProjectMeta({
      name: 'N',
      revision: 'A1',
      author: 'Ada',
      description: 'D'
    })
    const p = useProjectStore.getState().project
    expect(p).toMatchObject({ name: 'N', revision: 'A1', author: 'Ada', description: 'D' })
  })

  it('snapshots and restores revisions', () => {
    useProjectStore.getState().setProjectMeta({ name: 'Before' })
    useProjectStore.getState().addRevision('R1', 'desc')
    const rev = useProjectStore.getState().project.revisions![0]
    expect(rev.label).toBe('R1')

    useProjectStore.getState().setProjectMeta({ name: 'After' })
    useProjectStore.getState().restoreRevision(rev.id)
    expect(useProjectStore.getState().project.name).toBe('Before')
    expect(useProjectStore.getState().project.revisions).toHaveLength(1)
  })

  it('migrates a legacy two-endpoint harness on load', () => {
    const legacy = {
      id: 'p',
      name: 'Legacy',
      deviceInstances: [],
      harnesses: [
        {
          id: 'h',
          name: 'Old',
          a: { deviceInstanceId: 'i1', portId: 'p' },
          b: { deviceInstanceId: 'i2', portId: 'p' },
          lengthMm: 100
        }
      ],
      partSnapshots: {},
      templateSnapshots: {},
      revisions: []
    } as unknown as Project

    useProjectStore.getState().loadProject(legacy, '/tmp/x.wwv')
    const h = harnessById('h')
    expect(h.endpoints).toHaveLength(2)
    expect(h.segments).toEqual([{ fromEnd: 'a', toEnd: 'b', lengthMm: 100 }])
    expect(h.accessories).toEqual([])
    expect(h.splices).toEqual([])
    expect(useProjectStore.getState().filePath).toBe('/tmp/x.wwv')
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('finds the harness that owns an endpoint', () => {
    const { a, b, hid } = seedHarness()
    expect(useProjectStore.getState().findHarnessByEndpoint(a, 'pA')).toBe(hid)
    expect(useProjectStore.getState().findHarnessByEndpoint(b, 'pB')).toBe(hid)
    expect(useProjectStore.getState().findHarnessByEndpoint(a, 'nope')).toBeUndefined()
  })

  it('tracks dirty/saved state and resets on newProject', () => {
    useProjectStore.getState().markDirty()
    expect(useProjectStore.getState().dirty).toBe(true)
    useProjectStore.getState().markSaved('/tmp/f.wwv')
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(useProjectStore.getState().filePath).toBe('/tmp/f.wwv')

    seedHarness()
    useProjectStore.getState().newProject()
    expect(useProjectStore.getState().project.deviceInstances).toHaveLength(0)
    expect(useProjectStore.getState().filePath).toBeUndefined()
    expect(useProjectStore.getState().dirty).toBe(false)
  })
})
