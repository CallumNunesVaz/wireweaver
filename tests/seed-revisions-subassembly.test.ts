import { describe, it, expect } from 'vitest'
import { seedLibrary, seedPlaceholderParts } from '../src/model/seed'
import {
  createRevision,
  diffRevisions,
  restoreRevision
} from '../src/model/revisions'
import {
  createSubassembly,
  instantiateSubassembly,
  instantiateSubassemblyHarness
} from '../src/model/subassembly'
import type { PartBase } from '../src/model/types'
import { harness, lib, instances, project, clone } from './fixtures'

describe('seed content', () => {
  it('seeds two devices, a connector, two wires and one template', () => {
    const { parts, templates } = seedLibrary()
    expect(parts.filter((p) => p.kind === 'device')).toHaveLength(2)
    expect(parts.filter((p) => p.kind === 'connector')).toHaveLength(1)
    expect(parts.filter((p) => p.kind === 'wire')).toHaveLength(2)
    expect(templates).toHaveLength(1)
  })

  it('binds every seeded device port to the seeded template', () => {
    const { parts, templates } = seedLibrary()
    for (const p of parts) {
      if (p.kind !== 'device') continue
      expect(p.ports.length).toBeGreaterThan(0)
      expect(p.ports.every((port) => port.pinoutTemplateId === templates[0].id)).toBe(true)
    }
  })

  it('seeds placeholder parts that are all flagged', () => {
    const placeholders = seedPlaceholderParts()
    expect(placeholders).toHaveLength(3)
    expect(placeholders.every((p) => p.isPlaceholder)).toBe(true)
  })
})

describe('revisions', () => {
  it('snapshots a project without nested revisions', () => {
    const rev = createRevision(project, 'A1', 'first cut')
    expect(rev.label).toBe('A1')
    expect(rev.description).toBe('first cut')
    expect(rev.project.deviceInstances).toHaveLength(3)
    expect((rev.project as unknown as { revisions?: unknown }).revisions).toBeUndefined()
  })

  it('diffs added and removed devices and harnesses', () => {
    const after = clone(project)
    after.deviceInstances.push({ id: 'i9', partId: 'dev1', label: 'New', position: { x: 0, y: 0 } })
    after.harnesses.push({ id: 'h9', name: 'H9', endpoints: [], wires: [], segments: [] })

    const forward = diffRevisions(project, after)
    expect(forward.some((l) => l.includes("Added device 'New'"))).toBe(true)
    expect(forward.some((l) => l.includes("Added harness 'H9'"))).toBe(true)

    const backward = diffRevisions(after, project)
    expect(backward.some((l) => l.includes("Removed device 'New'"))).toBe(true)
    expect(backward.some((l) => l.includes("Removed harness 'H9'"))).toBe(true)
  })

  it('detects a changed wire count in an existing harness', () => {
    const after = clone(project)
    after.harnesses[0].wires.push({
      id: 'w9',
      from: { end: 'a', position: 2 },
      to: { end: 'b', position: 2 }
    })
    expect(diffRevisions(project, after).some((l) => l.includes('wire count'))).toBe(true)
  })

  it('restores a revision but keeps the project id and revision history', () => {
    const rev = createRevision(project, 'A1')
    const changed = { ...clone(project), name: 'Changed', revisions: [rev] }
    const restored = restoreRevision(changed, rev.id)
    expect(restored.name).toBe('Test Rig')
    expect(restored.id).toBe('p1')
    expect(restored.revisions).toEqual([rev])
  })

  it('is a no-op for an unknown revision id', () => {
    expect(restoreRevision(project, 'missing')).toBe(project)
  })
})

const base: Omit<PartBase, 'kind' | 'id'> = {
  name: 'Sub',
  type: 'Custom',
  internalPartNumber: '',
  manufacturer: '',
  manufacturerPartNumber: '',
  supplier: '',
  supplierPartNumber: ''
}

describe('subassembly model', () => {
  it('copies the harness and tags the kind', () => {
    const sub = createSubassembly(harness, 'Sub', base)
    expect(sub.kind).toBe('subassembly')
    expect(sub.harness.wires).toHaveLength(harness.wires.length)
    expect(sub.exposedPorts).toEqual([])
  })

  it('instantiateSubassembly creates a device instance and no endpoints without exposed ports', () => {
    const sub = createSubassembly(harness, 'Sub', base)
    const { instances: created, newHarness } = instantiateSubassembly(sub, { x: 10, y: 20 })
    expect(created).toHaveLength(1)
    expect(created[0].partId).toBe(sub.id)
    expect(created[0].position).toEqual({ x: 10, y: 20 })
    expect(newHarness.endpoints).toEqual([])
  })

  it('instantiateSubassembly maps exposed ports to endpoints and remaps wire ids', () => {
    const sub = {
      ...createSubassembly(harness, 'Sub', base),
      exposedPorts: [
        { id: 'ep1', name: 'P1', pinoutTemplateId: 'tpl1', side: 'right' as const },
        { id: 'ep2', name: 'P2', pinoutTemplateId: 'tpl1', side: 'left' as const }
      ]
    }
    const { newHarness } = instantiateSubassembly(sub, { x: 0, y: 0 })
    expect(newHarness.endpoints).toHaveLength(2)
    expect(newHarness.wires).toHaveLength(harness.wires.length)
    expect(newHarness.wires[0].id).not.toBe(harness.wires[0].id)
  })

  it('instantiateSubassemblyHarness matches placed devices by port id', () => {
    const sub = createSubassembly(harness, 'Sub', base)
    const res = instantiateSubassemblyHarness(lib, instances, sub)
    expect(res.harness).not.toBeNull()
    expect(res.matched).toBe(2)
    expect(res.missing).toBe(0)
    expect(res.harness!.endpoints).toHaveLength(2)
    expect(res.harness!.wires).toHaveLength(2)
  })

  it('instantiateSubassemblyHarness reports missing devices and yields null', () => {
    const sub = createSubassembly(harness, 'Sub', base)
    const res = instantiateSubassemblyHarness(lib, [], sub)
    expect(res.harness).toBeNull()
    expect(res.matched).toBe(0)
    expect(res.missing).toBe(2)
  })

  it('instantiateSubassemblyHarness does not reuse the same instance+port twice', () => {
    const sub = createSubassembly(
      { ...harness, endpoints: [harness.endpoints[0], harness.endpoints[0]] },
      'Sub',
      base
    )
    const res = instantiateSubassemblyHarness(lib, instances, sub)
    // Both endpoints resolve to the same port on different placed instances.
    expect(res.harness!.endpoints[0].deviceInstanceId).not.toBe(
      res.harness!.endpoints[1].deviceInstanceId
    )
  })
})
