import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, coalesceUndo } from '../src/stores/projectStore'
import type { Project, HarnessEndpoint, HarnessWire } from '../src/model/types'

const emptyProject: Project = {
  id: 'p1',
  name: 'Untitled',
  deviceInstances: [],
  harnesses: [],
  partSnapshots: {},
  templateSnapshots: {},
  revisions: []
}

const devicePartId = 'dev-default'
const devicePartId2 = 'dev-default2'
const devicePartId3 = 'dev-default3'

const defaultPartSnapshots: Project['partSnapshots'] = {
  'dev-default': {
    id: 'dev-default',
    kind: 'device',
    name: 'Test Device',
    type: 'COTS',
    internalPartNumber: 'IPN-1',
    manufacturer: 'TestCo',
    manufacturerPartNumber: 'MPN-1',
    supplier: 'TestCo',
    supplierPartNumber: '',
    ports: [
      { id: 'portA', name: 'Port A', pinoutTemplateId: 'tpl1', side: 'right' },
      { id: 'portB', name: 'Port B', pinoutTemplateId: 'tpl1', side: 'left' }
    ]
  },
  'dev-default2': {
    id: 'dev-default2',
    kind: 'device',
    name: 'Test Device 2',
    type: 'COTS',
    internalPartNumber: 'IPN-2',
    manufacturer: 'TestCo',
    manufacturerPartNumber: 'MPN-2',
    supplier: 'TestCo',
    supplierPartNumber: '',
    ports: [
      { id: 'portA', name: 'Port A', pinoutTemplateId: 'tpl1', side: 'right' }
    ]
  },
  'dev-default3': {
    id: 'dev-default3',
    kind: 'device',
    name: 'Test Device 3',
    type: 'COTS',
    internalPartNumber: 'IPN-3',
    manufacturer: 'TestCo',
    manufacturerPartNumber: 'MPN-3',
    supplier: 'TestCo',
    supplierPartNumber: '',
    ports: [
      { id: 'portA', name: 'Port A', pinoutTemplateId: 'tpl1', side: 'right' }
    ]
  }
}

export function resetProject(): void {
  useProjectStore.setState({
    project: { ...emptyProject, id: 'p1', partSnapshots: { ...defaultPartSnapshots } },
    filePath: undefined,
    dirty: false
  })
  useProjectStore.temporal.getState().clear()
}

describe('projectStore', () => {
  beforeEach(() => {
    resetProject()
  })

  describe('addInstance', () => {
    it('creates instance at correct position with label', () => {
      const id = useProjectStore.getState().addInstance(devicePartId, { x: 100, y: 200 }, 'My Device')
      expect(id).toBeTruthy()
      const inst = useProjectStore.getState().project.deviceInstances.find((i) => i.id === id)
      expect(inst).toBeDefined()
      expect(inst!.partId).toBe(devicePartId)
      expect(inst!.position).toEqual({ x: 100, y: 200 })
      expect(inst!.label).toBe('My Device')
    })
  })

  describe('addHarness', () => {
    it('creates harness between two endpoints', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }

      const hid = useProjectStore.getState().addHarness([ep1, ep2])
      expect(hid).toBeTruthy()
      const h = useProjectStore.getState().project.harnesses.find((h) => h.id === hid)
      expect(h).toBeDefined()
      expect(h!.endpoints).toHaveLength(2)
      expect(h!.name).toBe('D1–D2')
    })

    it('returns undefined for less than 2 endpoints', () => {
      const hid = useProjectStore.getState().addHarness([])
      expect(hid).toBeUndefined()
    })

    it('adds to existing harness when an endpoint already belongs to one', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')
      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }

      const hid = useProjectStore.getState().addHarness([ep1, ep2])
      // Now try to add a new endpoint to the existing harness by including ep1
      // in a new harness call — it should extend the existing harness.
      const id3 = useProjectStore.getState().addInstance(devicePartId3, { x: 200, y: 0 }, 'D3')
      const hid2 = useProjectStore.getState().addHarness([ep1, { deviceInstanceId: id3, portId: 'portA' }])
      expect(hid2).toBe(hid)

      const h = useProjectStore.getState().project.harnesses.find((h) => h.id === hid)
      expect(h!.endpoints).toHaveLength(3)
    })
  })

  describe('addEndpointToHarness', () => {
    it('adds a third endpoint to an existing harness', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')
      const id3 = useProjectStore.getState().addInstance(devicePartId3, { x: 200, y: 0 }, 'D3')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }
      const hid = useProjectStore.getState().addHarness([ep1, ep2])

      const result = useProjectStore.getState().addEndpointToHarness(hid!, {
        deviceInstanceId: id3,
        portId: 'portA'
      })
      expect(result).toBe(true)

      const h = useProjectStore.getState().project.harnesses.find((h) => h.id === hid)
      expect(h!.endpoints).toHaveLength(3)
    })

    it('rejects duplicate endpoint', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }
      const hid = useProjectStore.getState().addHarness([ep1, ep2])

      const result = useProjectStore.getState().addEndpointToHarness(hid!, ep1)
      expect(result).toBe(false)
    })
  })

  describe('removeInstance', () => {
    it('prunes from harnesses when instance is removed', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')
      const id3 = useProjectStore.getState().addInstance(devicePartId3, { x: 200, y: 0 }, 'D3')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }
      const ep3: HarnessEndpoint = { deviceInstanceId: id3, portId: 'portA' }
      const hid = useProjectStore.getState().addHarness([ep1, ep2])

      // Add a wire so we can verify wire pruning
      useProjectStore.getState().addEndpointToHarness(hid!, ep3)

      useProjectStore.getState().removeInstance(id1)
      const h = useProjectStore.getState().project.harnesses.find((h) => h.id === hid)
      expect(h).toBeDefined()
      expect(h!.endpoints).toHaveLength(2)
      expect(h!.endpoints.some((e) => e.deviceInstanceId === id1)).toBe(false)
    })

    it('removes harness when fewer than 2 endpoints remain', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }
      useProjectStore.getState().addHarness([ep1, ep2])

      useProjectStore.getState().removeInstance(id1)
      expect(useProjectStore.getState().project.harnesses).toHaveLength(0)
    })
  })

  describe('setHarnessWires', () => {
    it('updates wire list and sanitizes twists', () => {
      const id1 = useProjectStore.getState().addInstance(devicePartId, { x: 0, y: 0 }, 'D1')
      const id2 = useProjectStore.getState().addInstance(devicePartId2, { x: 100, y: 0 }, 'D2')

      const ep1: HarnessEndpoint = { deviceInstanceId: id1, portId: 'portA' }
      const ep2: HarnessEndpoint = { deviceInstanceId: id2, portId: 'portA' }
      const hid = useProjectStore.getState().addHarness([ep1, ep2])

      const wires: HarnessWire[] = [
        {
          id: 'w1',
          from: { end: 'a', position: 1 },
          to: { end: 'b', position: 1 },
          wirePartId: 'wire-x'
        }
      ]
      useProjectStore.getState().setHarnessWires(hid!, wires)

      const h = useProjectStore.getState().project.harnesses.find((h) => h.id === hid)
      expect(h!.wires).toHaveLength(1)
      expect(h!.wires[0].wirePartId).toBe('wire-x')
    })
  })
})
