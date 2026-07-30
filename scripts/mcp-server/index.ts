#!/usr/bin/env node
/**
 * WireWeaver MCP Server
 *
 * Exposes WireWeaver's project model via the Model Context Protocol (MCP) over
 * stdio. Reads a .wwv file specified by command-line argument or the
 * WW_PROJECT environment variable.
 *
 * Usage: npx tsx scripts/mcp-server/index.ts <path/to/project.wwv>
 *    or: WW_PROJECT=project.wwv npx tsx scripts/mcp-server/index.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { nanoid } from 'nanoid'

// ---------------------------------------------------------------------------
// Project model types (subset duplicated from src/model/types.ts for
// self-contained execution)
// ---------------------------------------------------------------------------

type PartKind = 'device' | 'connector' | 'wire' | 'subassembly'
type PartType = 'COTS' | 'MOTS' | 'Custom'
type PortSide = 'left' | 'right' | 'top' | 'bottom'

interface PinDef {
  position: number
  signal: string
  signalClass?: string
  maxCurrentAmps?: number
}

interface PinoutTemplate {
  id: string
  name: string
  connectorPartId: string
  pins: PinDef[]
}

interface DevicePort {
  id: string
  name: string
  pinoutTemplateId: string
  side: PortSide
}

interface PartBase {
  id: string
  kind: PartKind
  name: string
  type: PartType
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  manufacturerPartUrl?: string
  supplier: string
  supplierPartNumber: string
  cost?: { amount: number; currency: string }
  weightGrams?: number
  notes?: string
}

interface DevicePart extends PartBase {
  kind: 'device'
  ports: DevicePort[]
}

interface ConnectorPart extends PartBase {
  kind: 'connector'
  positions: number
  gender?: 'male' | 'female' | 'hermaphroditic'
}

interface WirePart extends PartBase {
  kind: 'wire'
  gauge?: string
  color?: string
}

interface SubassemblyPart extends PartBase {
  kind: 'subassembly'
}

type Part = DevicePart | ConnectorPart | WirePart | SubassemblyPart

interface DeviceInstance {
  id: string
  partId: string
  label: string
  position: { x: number; y: number }
}

interface HarnessEndpoint {
  deviceInstanceId: string
  portId: string
}

interface HarnessWire {
  id: string
  from: { end: string; position: number }
  to: { end: string; position: number }
  wirePartId?: string
  color?: string
}

interface HarnessSegment {
  fromEnd: string
  toEnd: string
  lengthMm?: number
}

interface Harness {
  id: string
  name: string
  endpoints: HarnessEndpoint[]
  wires: HarnessWire[]
  segments: HarnessSegment[]
}

interface Project {
  id: string
  name: string
  deviceInstances: DeviceInstance[]
  harnesses: Harness[]
  partSnapshots: Record<string, Part>
  templateSnapshots: Record<string, PinoutTemplate>
  revision?: string
  author?: string
  description?: string
}

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let currentProject: Project | null = null
let projectPath: string | null = null

function partById(id: string): Part | undefined {
  return currentProject?.partSnapshots[id]
}

function instanceById(id: string): DeviceInstance | undefined {
  return currentProject?.deviceInstances.find((i) => i.id === id)
}

function harnessById(id: string): Harness | undefined {
  return currentProject?.harnesses.find((h) => h.id === id)
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolReadProject(params: Record<string, unknown>): Promise<unknown> {
  const pp = params.path as string
  const resolved = path.resolve(pp)
  const raw = await fs.promises.readFile(resolved, 'utf8')
  const data = JSON.parse(raw) as Project
  currentProject = data
  projectPath = resolved
  return {
    name: data.name,
    id: data.id,
    deviceCount: data.deviceInstances.length,
    harnessCount: data.harnesses.length,
    revision: data.revision,
    author: data.author
  }
}

function toolListDevices(): unknown {
  if (!currentProject) return { error: 'No project loaded' }
  return currentProject.deviceInstances.map((inst) => {
    const part = partById(inst.partId)
    return {
      id: inst.id,
      label: inst.label,
      partId: inst.partId,
      partName: part?.name ?? '(unknown)',
      manufacturer: part?.manufacturer ?? '',
      position: inst.position,
      ports: part?.kind === 'device'
        ? (part as DevicePart).ports.map((p) => ({
            id: p.id,
            name: p.name,
            connected: currentProject!.harnesses.some((h) =>
              h.endpoints.some(
                (ep) => ep.deviceInstanceId === inst.id && ep.portId === p.id
              )
            )
          }))
        : []
    }
  })
}

function toolListHarnesses(): unknown {
  if (!currentProject) return { error: 'No project loaded' }
  return currentProject.harnesses.map((h) => ({
    id: h.id,
    name: h.name,
    endpointCount: h.endpoints.length,
    wireCount: h.wires.length,
    segmentCount: h.segments.length,
    endpoints: h.endpoints.map((ep) => {
      const inst = instanceById(ep.deviceInstanceId)
      return {
        deviceInstanceId: ep.deviceInstanceId,
        deviceLabel: inst?.label ?? '(unknown)',
        portId: ep.portId
      }
    })
  }))
}

function toolAddDevice(params: Record<string, unknown>): unknown {
  if (!currentProject) return { error: 'No project loaded' }
  const partId = params.partId as string
  const label = (params.label as string) || 'Device'
  const x = Number(params.x ?? 0)
  const y = Number(params.y ?? 0)
  const part = partById(partId)
  if (!part) return { error: `Part "${partId}" not found in project snapshots` }

  const inst: DeviceInstance = {
    id: nanoid(),
    partId,
    label,
    position: { x, y }
  }
  currentProject.deviceInstances.push(inst)
  return {
    id: inst.id,
    label: inst.label,
    partName: part.name,
    position: inst.position
  }
}

function toolConnectPorts(params: Record<string, unknown>): unknown {
  if (!currentProject) return { error: 'No project loaded' }

  const port1 = params.port1 as { deviceInstanceId: string; portId: string }
  const port2 = params.port2 as { deviceInstanceId: string; portId: string }

  if (!port1?.deviceInstanceId || !port1?.portId || !port2?.deviceInstanceId || !port2?.portId) {
    return { error: 'port1 and port2 must have deviceInstanceId and portId' }
  }

  if (
    port1.deviceInstanceId === port2.deviceInstanceId &&
    port1.portId === port2.portId
  ) {
    return { error: 'Cannot connect a port to itself' }
  }

  const inst1 = instanceById(port1.deviceInstanceId)
  const inst2 = instanceById(port2.deviceInstanceId)
  if (!inst1) return { error: `Instance "${port1.deviceInstanceId}" not found` }
  if (!inst2) return { error: `Instance "${port2.deviceInstanceId}" not found` }

  const part1 = currentProject.partSnapshots[inst1.partId]
  if (!part1 || part1.kind !== 'device' || !(part1 as DevicePart).ports.some(p => p.id === port1.portId)) return { error: 'Port not found for endpoint 1.' }
  const part2 = currentProject.partSnapshots[inst2.partId]
  if (!part2 || part2.kind !== 'device' || !(part2 as DevicePart).ports.some(p => p.id === port2.portId)) return { error: 'Port not found for endpoint 2.' }

  const existing = currentProject.harnesses.find((h) =>
    h.endpoints.some(
      (ep) =>
        ep.deviceInstanceId === port1.deviceInstanceId &&
        ep.portId === port1.portId
    )
  )

  if (existing) {
    const alreadyIn = existing.endpoints.some(
      (ep) =>
        ep.deviceInstanceId === port2.deviceInstanceId &&
        ep.portId === port2.portId
    )
    if (!alreadyIn) {
      existing.endpoints.push(port2)
    }
    return { harnessId: existing.id, name: existing.name, endpointCount: existing.endpoints.length }
  }

  const harness: Harness = {
    id: nanoid(),
    name: `${inst1.label}-${inst2.label}`,
    endpoints: [port1, port2],
    wires: [],
    segments: []
  }
  currentProject.harnesses.push(harness)
  return { harnessId: harness.id, name: harness.name, endpointCount: 2 }
}

async function toolSaveProject(): Promise<string> {
  if (!currentProject || !projectPath) return 'No project loaded.'
  await fs.promises.writeFile(projectPath, JSON.stringify(currentProject, null, 2))
  return 'Project saved.'
}

function toolExportBom(params: Record<string, unknown>): unknown {
  if (!currentProject) return { error: 'No project loaded' }
  const format = (params.format as string) || 'json'

  interface BomRow {
    category: string
    name: string
    ipn: string
    manufacturer: string
    mpn: string
    quantity: number
    cost?: { amount: number; currency: string }
    weightGrams?: number
  }

  const counts = new Map<string, { qty: number }>()
  const bump = (partId: string) => {
    const c = counts.get(partId) ?? { qty: 0 }
    c.qty += 1
    counts.set(partId, c)
  }

  for (const inst of currentProject.deviceInstances) bump(inst.partId)

  for (const h of currentProject.harnesses) {
    for (const w of h.wires) if (w.wirePartId) bump(w.wirePartId)
    for (const ep of h.endpoints) {
      const inst = instanceById(ep.deviceInstanceId)
      const part = inst ? partById(inst.partId) : undefined
      if (part?.kind === 'device') {
        const port = (part as DevicePart).ports.find((p) => p.id === ep.portId)
        if (port) {
          const tpl = currentProject.templateSnapshots[port.pinoutTemplateId]
          if (tpl) bump(tpl.connectorPartId)
        }
      }
    }
  }

  const rows: BomRow[] = []
  for (const [partId, { qty }] of counts) {
    const part = partById(partId)
    if (!part) continue
    rows.push({
      category: part.kind,
      name: part.name,
      ipn: part.internalPartNumber,
      manufacturer: part.manufacturer,
      mpn: part.manufacturerPartNumber,
      quantity: qty,
      cost: part.cost,
      weightGrams: part.weightGrams
    })
  }

  if (format === 'csv') {
    const header = 'Category,Name,Internal PN,Manufacturer,MPN,Qty,Unit Cost,Weight (g)'
    const lines = rows.map((r) =>
      [
        r.category,
        r.name,
        r.ipn,
        r.manufacturer,
        r.mpn,
        r.quantity,
        r.cost ? `${r.cost.amount} ${r.cost.currency}` : '',
        r.weightGrams ?? ''
      ]
        .map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v)))
        .join(',')
    )
    return [header, ...lines].join('\n')
  }

  return rows
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> = {
  read_project: toolReadProject,
  list_devices: toolListDevices,
  list_harnesses: toolListHarnesses,
  add_device: toolAddDevice,
  connect_ports: toolConnectPorts,
  export_bom: toolExportBom,
  save_project: toolSaveProject
}

const TOOL_SCHEMAS = {
  read_project: {
    description: 'Read a .wwv project file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to the .wwv file' } },
      required: ['path']
    }
  },
  list_devices: {
    description: 'List device instances in the current project',
    inputSchema: { type: 'object', properties: {} }
  },
  list_harnesses: {
    description: 'List harnesses in the current project',
    inputSchema: { type: 'object', properties: {} }
  },
  add_device: {
    description: 'Add a device instance to the project',
    inputSchema: {
      type: 'object',
      properties: {
        partId: { type: 'string', description: 'Part ID from project snapshots' },
        label: { type: 'string', description: 'Display label' },
        x: { type: 'number', description: 'X position' },
        y: { type: 'number', description: 'Y position' }
      },
      required: ['partId']
    }
  },
  connect_ports: {
    description: 'Create or extend a harness connecting two ports',
    inputSchema: {
      type: 'object',
      properties: {
        port1: {
          type: 'object',
          properties: {
            deviceInstanceId: { type: 'string' },
            portId: { type: 'string' }
          },
          required: ['deviceInstanceId', 'portId']
        },
        port2: {
          type: 'object',
          properties: {
            deviceInstanceId: { type: 'string' },
            portId: { type: 'string' }
          },
          required: ['deviceInstanceId', 'portId']
        }
      },
      required: ['port1', 'port2']
    }
  },
  export_bom: {
    description: 'Export a bill of materials for the current project',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['csv', 'json'], description: 'Output format' }
      }
    }
  },
  save_project: {
    description: 'Save the current project to disk',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
}

// ---------------------------------------------------------------------------
// MCP protocol loop
// ---------------------------------------------------------------------------

function respond(id: number | string, result: unknown): void {
  const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result }
  process.stdout.write(JSON.stringify(resp) + '\n')
}

function error(id: number | string | null, code: number, message: string): void {
  if (id === null) return
  const resp: JsonRpcResponse = { jsonrpc: '2.0', id: id ?? 0, error: { code, message } }
  process.stdout.write(JSON.stringify(resp) + '\n')
}

async function main(): Promise<void> {
  const cliArg = process.argv[2]
  const envPath = process.env['WW_PROJECT']
  const initialPath = cliArg || envPath || null

  if (initialPath) {
    try {
      const resolved = path.resolve(initialPath)
      const raw = await fs.promises.readFile(resolved, 'utf8')
      currentProject = JSON.parse(raw) as Project
      projectPath = resolved
      process.stderr.write(`MCP: loaded ${currentProject.name} from ${resolved}\n`)
    } catch (e) {
      process.stderr.write(`MCP: could not load ${initialPath}: ${e}\n`)
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  process.on('SIGTERM', () => { rl.close(); process.exit(0) })
  process.on('SIGINT', () => { rl.close(); process.exit(0) })

  for await (const line of rl) {
    try {
      const msg = JSON.parse(line) as JsonRpcRequest

      if (msg.method === 'initialize') {
        respond(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'wireweaver-mcp', version: '0.1.0' }
        })
      } else if (msg.method === 'tools/list') {
        respond(msg.id, {
          tools: Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
            name,
            ...schema
          }))
        })
      } else if (msg.method === 'tools/call') {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
        const toolName = params.name ?? ''
        const toolArgs = params.arguments ?? {}
        const fn = TOOLS[toolName]
        if (!fn) {
          error(msg.id, -32601, `Unknown tool: ${toolName}`)
          continue
        }
        try {
          const result = await fn(toolArgs)
          respond(msg.id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          })
        } catch (e: any) {
          respond(msg.id, {
            content: [{ type: 'text', text: `Error: ${e.message}` }],
            isError: true
          })
        }
      } else if (msg.method === 'ping') {
        respond(msg.id, {})
      } else {
        error(msg.id, -32601, `Unknown method: ${msg.method}`)
      }
    } catch {
      const resp = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      process.stdout.write(resp + '\n')
    }
  }
}

main().catch((err) => {
  process.stderr.write(`MCP fatal: ${err}\n`)
  process.exit(1)
})
