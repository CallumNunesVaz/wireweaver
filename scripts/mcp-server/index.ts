#!/usr/bin/env node
/**
 * WireWeaver MCP server.
 *
 * A thin Model Context Protocol (stdio) transport over the shared programmatic
 * API in `src/model/api.ts`, so agents get exactly the same harness-creation
 * behaviour as the app. Persistence is a single `.wwv` file.
 *
 * Run:  npx vite-node scripts/mcp-server/index.ts [project.wwv]
 *    or: WW_PROJECT=project.wwv npx vite-node scripts/mcp-server/index.ts
 * Help: npx vite-node scripts/mcp-server/index.ts --help
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as api from '../../src/model/api'
import type { Project } from '../../src/model/types'

const VERSION = '0.2.0'

let ws: api.Workspace = api.createWorkspace()
let currentPath: string | null = null

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>

interface ToolDef {
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Args) => unknown
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)

function load(pathArg: string): void {
  const resolved = path.resolve(pathArg)
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Project
  ws = api.loadWorkspace(data)
  currentPath = resolved
}

function save(pathArg?: string): string {
  const target = pathArg ? path.resolve(pathArg) : currentPath
  if (!target) throw new Error('No project path set — pass one to save_project')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(api.serializeWorkspace(ws), null, 2), 'utf8')
  currentPath = target
  return target
}

const TOOLS: Record<string, ToolDef> = {
  // ---------------- Project ----------------
  create_project: {
    description: 'Create a new empty project workspace',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    handler: (a) => {
      ws = api.createWorkspace(str(a.name, 'Untitled'))
      currentPath = null
      return api.summarize(ws)
    }
  },
  read_project: {
    description: 'Load a .wwv project file into the workspace',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    handler: (a) => {
      load(str(a.path))
      return api.summarize(ws)
    }
  },
  save_project: {
    description: 'Save the workspace to disk (.wwv), embedding part snapshots',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    handler: (a) => ({ path: save(a.path ? str(a.path) : undefined) })
  },
  summarize_project: {
    description: 'Counts of devices, harnesses, wires, parts and DRC issues',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.summarize(ws)
  },

  // ---------------- Library: parts & templates ----------------
  list_parts: {
    description: 'List library parts (devices, connectors, wires, subassemblies)',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['device', 'connector', 'wire', 'subassembly'] } }
    },
    handler: (a) =>
      ws.parts
        .filter((p) => !a.kind || p.kind === a.kind)
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          manufacturerPartNumber: p.manufacturerPartNumber,
          ...(p.kind === 'connector' ? { positions: p.positions } : {}),
          ...(p.kind === 'device' ? { ports: p.ports.length } : {})
        }))
  },
  list_templates: {
    description: 'List pinout templates',
    inputSchema: { type: 'object', properties: {} },
    handler: () =>
      ws.templates.map((t) => ({
        id: t.id,
        name: t.name,
        connectorPartId: t.connectorPartId,
        pins: t.pins.map((p) => ({ position: p.position, signal: p.signal }))
      }))
  },
  create_connector: {
    description: 'Create a connector part',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        positions: { type: 'number' },
        gender: { type: 'string', enum: ['male', 'female', 'hermaphroditic'] },
        manufacturer: { type: 'string' },
        manufacturerPartNumber: { type: 'string' },
        supplier: { type: 'string' },
        supplierPartNumber: { type: 'string' },
        internalPartNumber: { type: 'string' },
        currentRatingAmps: { type: 'number' }
      },
      required: ['name', 'positions']
    },
    handler: (a) =>
      api.createConnectorPart(ws, {
        name: str(a.name),
        positions: num(a.positions, 1),
        gender: a.gender as never,
        manufacturer: str(a.manufacturer),
        manufacturerPartNumber: str(a.manufacturerPartNumber),
        supplier: str(a.supplier),
        supplierPartNumber: str(a.supplierPartNumber),
        internalPartNumber: str(a.internalPartNumber),
        currentRatingAmps: typeof a.currentRatingAmps === 'number' ? a.currentRatingAmps : undefined
      })
  },
  create_wire_part: {
    description: 'Create a wire part (single conductor or multi-core cable)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        gauge: { type: 'string' },
        color: { type: 'string' },
        conductors: { type: 'number' },
        colorCode: { type: 'string', enum: ['DIN', 'IEC', 'TEL', 'T568A', 'T568B'] },
        shield: { type: 'boolean' },
        category: { type: 'string', enum: ['cable', 'bundle'] },
        manufacturerPartNumber: { type: 'string' }
      },
      required: ['name']
    },
    handler: (a) =>
      api.createWirePart(ws, {
        name: str(a.name),
        gauge: str(a.gauge) || undefined,
        color: str(a.color) || undefined,
        conductors: num(a.conductors, 1),
        colorCode: a.colorCode as never,
        shield: a.shield === true,
        category: a.category as never,
        manufacturerPartNumber: str(a.manufacturerPartNumber)
      })
  },
  create_device_part: {
    description: 'Create a device part with named ports bound to pinout templates',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        ports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              pinoutTemplateId: { type: 'string' },
              side: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] }
            },
            required: ['name', 'pinoutTemplateId']
          }
        }
      },
      required: ['name']
    },
    handler: (a) =>
      api.createDevicePart(ws, {
        name: str(a.name),
        ports: (Array.isArray(a.ports) ? a.ports : []) as never
      })
  },
  create_pinout_template: {
    description:
      'Create a pinout template; pins default to the connector position count',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        connectorPartId: { type: 'string' },
        pins: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'number' },
              signal: { type: 'string' },
              signalClass: { type: 'string', enum: ['power', 'ground', 'data', 'shield', 'nc'] },
              maxCurrentAmps: { type: 'number' }
            },
            required: ['position']
          }
        }
      },
      required: ['name', 'connectorPartId']
    },
    handler: (a) =>
      api.createPinoutTemplate(ws, {
        name: str(a.name),
        connectorPartId: str(a.connectorPartId),
        pins: Array.isArray(a.pins) ? (a.pins as never) : undefined
      })
  },
  import_wireviz: {
    description: 'Import connectors/cables/templates from a WireViz YAML string',
    inputSchema: {
      type: 'object',
      properties: { yaml: { type: 'string' } },
      required: ['yaml']
    },
    handler: (a) => {
      const imported = api.importWireVizDoc(ws, str(a.yaml))
      return { parts: imported.parts.length, templates: imported.templates.length }
    }
  },

  // ---------------- Assembly ----------------
  list_devices: {
    description: 'List placed device instances with their ports',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.listDevices(ws)
  },
  add_device: {
    description: 'Place a device instance (by partId or partName)',
    inputSchema: {
      type: 'object',
      properties: {
        partId: { type: 'string' },
        partName: { type: 'string' },
        label: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' }
      }
    },
    handler: (a) =>
      api.addDevice(ws, {
        partId: a.partId ? str(a.partId) : undefined,
        partName: a.partName ? str(a.partName) : undefined,
        label: a.label ? str(a.label) : undefined,
        position: { x: num(a.x), y: num(a.y) }
      })
  },
  remove_device: {
    description: 'Remove a device instance and prune affected harnesses',
    inputSchema: {
      type: 'object',
      properties: { instanceId: { type: 'string' } },
      required: ['instanceId']
    },
    handler: (a) => {
      api.removeDevice(ws, str(a.instanceId))
      return api.summarize(ws)
    }
  },

  // ---------------- Harnesses ----------------
  list_harnesses: {
    description: 'List harnesses with endpoint and wire counts',
    inputSchema: { type: 'object', properties: {} },
    handler: () =>
      ws.project.harnesses.map((h) => ({
        id: h.id,
        name: h.name,
        endpoints: h.endpoints.length,
        wires: h.wires.length,
        segments: h.segments.length,
        splices: (h.splices ?? []).length
      }))
  },
  get_harness: {
    description: 'Full detail of one harness (endpoints, wires, signals, segments)',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' } },
      required: ['harnessId']
    },
    handler: (a) => api.harnessDetail(ws, str(a.harnessId))
  },
  create_harness: {
    description:
      'Create a harness. Endpoints can be given as raw endpoints or as {device, port} pairs; wires may be supplied inline and will auto-add missing endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        ports: {
          type: 'array',
          items: {
            type: 'object',
            properties: { device: { type: 'string' }, port: { type: 'string' } },
            required: ['device', 'port']
          }
        },
        endpoints: { type: 'array', items: { type: 'object' } },
        wires: { type: 'array', items: { type: 'object' } },
        segments: { type: 'array', items: { type: 'object' } },
        accessories: { type: 'array', items: { type: 'object' } },
        splices: { type: 'array', items: { type: 'object' } }
      }
    },
    handler: (a) =>
      api.harnessDetail(
        ws,
        api.createHarness(ws, {
          name: a.name ? str(a.name) : undefined,
          ports: a.ports as never,
          endpoints: a.endpoints as never,
          wires: a.wires as never,
          segments: a.segments as never,
          accessories: a.accessories as never,
          splices: a.splices as never
        }).id
      )
  },
  delete_harness: {
    description: 'Delete a harness',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' } },
      required: ['harnessId']
    },
    handler: (a) => {
      api.deleteHarness(ws, str(a.harnessId))
      return api.summarize(ws)
    }
  },
  rename_harness: {
    description: 'Rename a harness',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' }, name: { type: 'string' } },
      required: ['harnessId', 'name']
    },
    handler: (a) => api.renameHarness(ws, str(a.harnessId), str(a.name))
  },
  add_endpoint: {
    description: 'Add a device port as an endpoint of a harness',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        deviceInstanceId: { type: 'string' },
        portId: { type: 'string' }
      },
      required: ['harnessId', 'deviceInstanceId', 'portId']
    },
    handler: (a) => ({
      end: api.addEndpoint(ws, str(a.harnessId), {
        deviceInstanceId: str(a.deviceInstanceId),
        portId: str(a.portId)
      })
    })
  },
  add_wire: {
    description:
      'Add one wire. from/to accept {end,position}, {device,port,position} or {deviceInstanceId,portId,position}.',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        from: { type: 'object' },
        to: { type: 'object' },
        wirePartId: { type: 'string' },
        color: { type: 'string' },
        label: { type: 'string' }
      },
      required: ['harnessId', 'from', 'to']
    },
    handler: (a) =>
      api.addWire(ws, str(a.harnessId), {
        from: a.from as never,
        to: a.to as never,
        wirePartId: a.wirePartId ? str(a.wirePartId) : undefined,
        color: a.color ? str(a.color) : undefined,
        label: a.label ? str(a.label) : undefined
      })
  },
  add_wires: {
    description: 'Add many wires in one call',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        wires: { type: 'array', items: { type: 'object' } }
      },
      required: ['harnessId', 'wires']
    },
    handler: (a) => api.addWires(ws, str(a.harnessId), (a.wires as never) ?? [])
  },
  update_wire: {
    description: 'Patch a wire (color, label, wirePartId, twistedWith)',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        wireId: { type: 'string' },
        patch: { type: 'object' }
      },
      required: ['harnessId', 'wireId', 'patch']
    },
    handler: (a) => api.updateWire(ws, str(a.harnessId), str(a.wireId), (a.patch as never) ?? {})
  },
  remove_wire: {
    description: 'Delete a wire',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' }, wireId: { type: 'string' } },
      required: ['harnessId', 'wireId']
    },
    handler: (a) => {
      api.removeWire(ws, str(a.harnessId), str(a.wireId))
      return { ok: true }
    }
  },
  auto_wire: {
    description: 'Wire endpoints by matching pin signal names',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        allPairs: { type: 'boolean' },
        overwrite: { type: 'boolean' }
      },
      required: ['harnessId']
    },
    handler: (a) => {
      const added = api.autoWire(ws, str(a.harnessId), {
        allPairs: a.allPairs === true,
        overwrite: a.overwrite === true
      })
      return { added: added.length }
    }
  },
  set_segment: {
    description: 'Set a segment length (and optional label) between two ends',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        lengthMm: { type: 'number' },
        label: { type: 'string' }
      },
      required: ['harnessId', 'from', 'to']
    },
    handler: (a) =>
      api.addSegment(ws, str(a.harnessId), {
        from: str(a.from),
        to: str(a.to),
        lengthMm: typeof a.lengthMm === 'number' ? a.lengthMm : undefined,
        label: a.label ? str(a.label) : undefined
      })
  },
  add_accessory: {
    description: 'Attach an accessory (contact, backshell, seal, …) to a harness',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        category: { type: 'string' },
        partId: { type: 'string' },
        quantity: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['harnessId', 'category', 'partId']
    },
    handler: (a) =>
      api.addAccessory(ws, str(a.harnessId), {
        category: str(a.category) as never,
        partId: str(a.partId),
        quantity: num(a.quantity, 1),
        notes: a.notes ? str(a.notes) : undefined
      })
  },
  remove_accessory: {
    description: 'Remove a harness accessory',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' }, accessoryId: { type: 'string' } },
      required: ['harnessId', 'accessoryId']
    },
    handler: (a) => {
      api.removeAccessory(ws, str(a.harnessId), str(a.accessoryId))
      return { ok: true }
    }
  },
  add_splice: {
    description: 'Join two or more wires at a splice',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        wireIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' }
      },
      required: ['harnessId', 'wireIds']
    },
    handler: (a) =>
      api.addSplice(
        ws,
        str(a.harnessId),
        (a.wireIds as string[]) ?? [],
        a.name ? str(a.name) : undefined
      )
  },
  remove_splice: {
    description: 'Remove a splice',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' }, spliceId: { type: 'string' } },
      required: ['harnessId', 'spliceId']
    },
    handler: (a) => {
      api.removeSplice(ws, str(a.harnessId), str(a.spliceId))
      return { ok: true }
    }
  },
  assign_splice_wire: {
    description: 'Assign a wire part to a splice (or clear it)',
    inputSchema: {
      type: 'object',
      properties: {
        harnessId: { type: 'string' },
        spliceId: { type: 'string' },
        wirePartId: { type: 'string' }
      },
      required: ['harnessId', 'spliceId']
    },
    handler: (a) =>
      api.assignSpliceWire(
        ws,
        str(a.harnessId),
        str(a.spliceId),
        a.wirePartId ? str(a.wirePartId) : undefined
      )
  },
  save_as_subassembly: {
    description: 'Store a harness as a reusable subassembly part in the library',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' }, name: { type: 'string' } },
      required: ['harnessId', 'name']
    },
    handler: (a) => api.saveAsSubassembly(ws, str(a.harnessId), str(a.name))
  },
  insert_subassembly: {
    description: 'Insert a subassembly harness into the project, matching placed devices',
    inputSchema: {
      type: 'object',
      properties: { subassemblyId: { type: 'string' } },
      required: ['subassemblyId']
    },
    handler: (a) => {
      const { harness, matched, missing } = api.insertSubassembly(ws, str(a.subassemblyId))
      return { harnessId: harness.id, matched, missing }
    }
  },

  // ---------------- Validation & reports ----------------
  validate: {
    description: 'Run the design rule check and return issues',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.validate(ws)
  },
  wiring_table: {
    description: 'From-to wiring table for the whole project',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.wiringTable(ws)
  },
  cutlist: {
    description: 'Aggregated cut list (wire part × gauge × color × length)',
    inputSchema: {
      type: 'object',
      properties: { slackMm: { type: 'number' } }
    },
    handler: (a) => api.cutlist(ws, num(a.slackMm, 0))
  },
  netlist: {
    description: 'Electrical nets across all harnesses',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.netlist(ws)
  },
  export_bom: {
    description: 'Bill of materials as JSON or CSV',
    inputSchema: {
      type: 'object',
      properties: { format: { type: 'string', enum: ['json', 'csv'] } }
    },
    handler: (a) =>
      a.format === 'csv' ? api.bomText(ws, 'csv') : api.bomText(ws, 'json')
  },
  export_wireviz: {
    description: 'Export a harness as WireViz YAML',
    inputSchema: {
      type: 'object',
      properties: { harnessId: { type: 'string' } },
      required: ['harnessId']
    },
    handler: (a) => api.exportWireViz(ws, str(a.harnessId))
  },

  // ---------------- Revisions ----------------
  list_revisions: {
    description: 'List project revisions',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api.listRevisions(ws)
  },
  create_revision: {
    description: 'Snapshot the current project as a named revision',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string' }, description: { type: 'string' } },
      required: ['label']
    },
    handler: (a) =>
      api.createRevision(ws, str(a.label), a.description ? str(a.description) : undefined)
  },
  diff_revision: {
    description: 'Structural diff between a revision and the current project',
    inputSchema: {
      type: 'object',
      properties: { revisionId: { type: 'string' } },
      required: ['revisionId']
    },
    handler: (a) => api.diffRevision(ws, str(a.revisionId))
  },
  restore_revision: {
    description: 'Restore the project to a saved revision',
    inputSchema: {
      type: 'object',
      properties: { revisionId: { type: 'string' } },
      required: ['revisionId']
    },
    handler: (a) => {
      api.restoreRevision(ws, str(a.revisionId))
      return api.summarize(ws)
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP loop
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

function respond(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function error(id: number | string | null, code: number, message: string): void {
  if (id === null) return
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'
  )
}

function printHelp(): void {
  process.stdout.write(
    `WireWeaver MCP server v${VERSION}\n\n` +
      `Usage: vite-node scripts/mcp-server/index.ts [project.wwv]\n` +
      `   or: WW_PROJECT=project.wwv vite-node scripts/mcp-server/index.ts\n\n` +
      `Speaks MCP (JSON-RPC) over stdio. Tools: ${Object.keys(TOOLS).length}.\n`
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    return
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(VERSION + '\n')
    return
  }

  const initial = argv.find((a) => !a.startsWith('-')) || process.env['WW_PROJECT']
  if (initial) {
    try {
      load(initial)
      process.stderr.write(`MCP: loaded "${ws.project.name}" from ${currentPath}\n`)
    } catch (e) {
      process.stderr.write(`MCP: could not load ${initial}: ${e}\n`)
    }
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  process.on('SIGTERM', () => {
    rl.close()
    process.exit(0)
  })
  process.on('SIGINT', () => {
    rl.close()
    process.exit(0)
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(line) as JsonRpcRequest
    } catch {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'
      )
      continue
    }

    try {
      if (msg.method === 'initialize') {
        respond(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'wireweaver-mcp', version: VERSION }
        })
      } else if (msg.method === 'tools/list') {
        respond(msg.id, {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        })
      } else if (msg.method === 'tools/call') {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Args }
        const tool = TOOLS[params.name ?? '']
        if (!tool) {
          error(msg.id, -32601, `Unknown tool: ${params.name}`)
          continue
        }
        try {
          const result = tool.handler(params.arguments ?? {})
          respond(msg.id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          })
        } catch (e) {
          respond(msg.id, {
            content: [
              { type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }
            ],
            isError: true
          })
        }
      } else if (msg.method === 'ping') {
        respond(msg.id, {})
      } else {
        error(msg.id, -32601, `Unknown method: ${msg.method}`)
      }
    } catch (e) {
      error(msg.id, -32603, e instanceof Error ? e.message : String(e))
    }
  }
}

main().catch((err) => {
  process.stderr.write(`MCP fatal: ${err}\n`)
  process.exit(1)
})
