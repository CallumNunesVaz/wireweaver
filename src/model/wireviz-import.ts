import { nanoid } from 'nanoid'
import YAML from 'yaml'
import type { Part, PinoutTemplate, ConnectorPart, WirePart } from './types'
import type { LibraryLike } from './derivation'

interface WireVizDoc {
  connectors?: Record<string, {
    type?: string
    pincount?: number
    pins?: number[]
    pinlabels?: (string | number)[]
    mpn?: string
  }>
  cables?: Record<string, {
    gauge?: string | number
    length?: number
    colors?: string[]
    wirecount?: number
    color_code?: string
    shield?: boolean
    show_name?: boolean
  }>
  connections?: {
    from: string
    to: string
    pins?: (number | null)[]
  }[][] | [Record<string, number[]>, ...(string | Record<string, number[]>)[], Record<string, number[]>]
}

function ensureConnector(existing: Record<string, Part>, name: string, info: NonNullable<WireVizDoc['connectors']>[string]): ConnectorPart {
  const id = `wv-conn-${nanoid()}`
  const connector: ConnectorPart = {
    id,
    kind: 'connector',
    name: info.type ?? name,
    type: 'COTS',
    internalPartNumber: `WV-${name}`,
    manufacturer: '',
    manufacturerPartNumber: info.mpn ?? '',
    supplier: '',
    supplierPartNumber: '',
    positions: info.pincount ?? (info.pins?.length ?? 1)
  }
  existing[id] = connector
  return connector
}

function ensureWire(existing: Record<string, Part>, info: NonNullable<WireVizDoc['cables']>[string]): WirePart {
  const uid = nanoid()
  const id = `wv-wire-${uid}`
  const wire: WirePart = {
    id,
    kind: 'wire',
    name: `${info.gauge ?? '?'} ${info.colors?.join('/') ?? ''}`.trim(),
    type: 'COTS',
    internalPartNumber: `WV-WIRE-${uid}`,
    manufacturer: '',
    manufacturerPartNumber: '',
    supplier: '',
    supplierPartNumber: '',
    gauge: typeof info.gauge === 'number' ? `${info.gauge} mm²` : info.gauge,
    shield: info.shield
  }
  existing[id] = wire
  return wire
}

export function importWireViz(
  yamlString: string,
  existingLib: LibraryLike
): { parts: Part[]; templates: PinoutTemplate[] } {
  let doc: WireVizDoc
  try {
    doc = YAML.parse(yamlString)
  } catch {
    return { parts: [], templates: [] }
  }

  const parts: Record<string, Part> = { ...existingLib.parts }
  const templates: PinoutTemplate[] = []

  if (doc.connectors) {
    for (const [name, info] of Object.entries(doc.connectors)) {
      if (!info) continue
      const connector = ensureConnector(parts, name, info)
      const tpl: PinoutTemplate = {
        id: `wv-tpl-${nanoid()}`,
        name: `${name} pinout`,
        connectorPartId: connector.id,
        pins: (info.pins ?? []).map((pos) => ({
          position: pos,
          signal: ''
        }))
      }
      templates.push(tpl)
    }
  }

  if (doc.cables) {
    for (const [, info] of Object.entries(doc.cables)) {
      if (!info) continue
      ensureWire(parts, info)
    }
  }

  return {
    parts: Object.values(parts).filter(
      (p) => !(existingLib.parts[p.id])
    ),
    templates
  }
}
