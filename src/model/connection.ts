/**
 * Pure planning for connecting device ports into harnesses. Shared by the
 * mouse-drag path (Assembly view), the "Connect ports…" dialog and the MCP /
 * programmatic API. Returns a plan the caller commits; it never mutates state.
 */
import type { Harness, HarnessEndpoint, Project } from './types'

/** Find the harness id that contains this endpoint, if any. */
export function findHarnessByEndpoint(
  harnesses: Harness[],
  deviceInstanceId: string,
  portId: string
): string | undefined {
  for (const h of harnesses) {
    for (const ep of h.endpoints) {
      if (ep.deviceInstanceId === deviceInstanceId && ep.portId === portId) return h.id
    }
  }
  return undefined
}

export type ConnectionPlan =
  /** Neither port is wired yet: create a fresh harness with both. */
  | { kind: 'create' }
  /** Exactly one port is wired: add the other to its harness. */
  | { kind: 'join'; harnessId: string; endpoint: HarnessEndpoint }
  /** Both ports already share a harness: nothing to do. */
  | { kind: 'noop' }
  /** Not connectable (self-connection, or ports in different harnesses). */
  | { kind: 'error'; message: string }

export function planConnection(
  project: Project,
  ep1: HarnessEndpoint,
  ep2: HarnessEndpoint
): ConnectionPlan {
  if (ep1.deviceInstanceId === ep2.deviceInstanceId) {
    return { kind: 'error', message: 'A device cannot be connected to itself.' }
  }

  const existing1 = findHarnessByEndpoint(project.harnesses, ep1.deviceInstanceId, ep1.portId)
  const existing2 = findHarnessByEndpoint(project.harnesses, ep2.deviceInstanceId, ep2.portId)

  if (existing1 && existing2) {
    if (existing1 !== existing2) {
      return { kind: 'error', message: 'Both ports already belong to different harnesses.' }
    }
    return { kind: 'noop' }
  }

  if (existing1) return { kind: 'join', harnessId: existing1, endpoint: ep2 }
  if (existing2) return { kind: 'join', harnessId: existing2, endpoint: ep1 }
  return { kind: 'create' }
}
