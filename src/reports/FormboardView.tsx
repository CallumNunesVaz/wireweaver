import { useMemo } from 'react'
import { FileDown } from 'lucide-react'
import { toast } from '../shared/toast'
import type { LibraryLike } from '../model/derivation'
import { generateFormboardLayout } from '../model/formboard'
import { endIndex, type Harness, type Project } from '../model/types'

interface Props {
  lib: LibraryLike
  project: Project
  harness: Harness
}

/**
 * 1:1-scale formboard preview. Renders the segment graph as an SVG so it can be
 * printed and pinned to the build bench. 1 mm = 1 px before the viewBox scale.
 */
export function FormboardView({ lib, project, harness }: Props) {
  const { nodes, edges, width, height } = useMemo(() => {
    const nodes = generateFormboardLayout(harness, lib, project.deviceInstances)
    const edges = (harness.segments ?? [])
      .map((s) => {
        const a = nodes[endIndex(s.fromEnd)]
        const b = nodes[endIndex(s.toEnd)]
        return a && b ? { a, b, lengthMm: s.lengthMm } : null
      })
      .filter((e): e is NonNullable<typeof e> => e != null)
    const pad = 60
    const maxX = Math.max(0, ...nodes.map((n) => n.x))
    const maxY = Math.max(0, ...nodes.map((n) => n.y))
    const minX = Math.min(0, ...nodes.map((n) => n.x))
    const minY = Math.min(0, ...nodes.map((n) => n.y))
    return {
      nodes,
      edges,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      minX,
      minY
    }
  }, [harness, lib, project.deviceInstances])

  const bounds = useMemo(() => {
    const xs = nodes.map((n) => n.x)
    const ys = nodes.map((n) => n.y)
    return {
      minX: Math.min(0, ...xs),
      minY: Math.min(0, ...ys)
    }
  }, [nodes])

  const svgText = useMemo(() => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const lines = edges
      .map(
        (e) =>
          `<line x1="${e.a.x - bounds.minX}" y1="${e.a.y - bounds.minY}" x2="${e.b.x - bounds.minX}" y2="${e.b.y - bounds.minY}" stroke="#5b9bff" stroke-width="2" />`
      )
      .join('')
    const circles = nodes
      .map(
        (n) =>
          `<circle cx="${n.x - bounds.minX}" cy="${n.y - bounds.minY}" r="14" fill="#232730" stroke="#5b9bff" stroke-width="2" />` +
          `<text x="${n.x - bounds.minX}" y="${n.y - bounds.minY + 4}" font-size="10" text-anchor="middle" fill="#e7e9ee">${esc(n.label.slice(0, 3))}</text>` +
          `<text x="${n.x - bounds.minX}" y="${n.y - bounds.minY + 28}" font-size="10" text-anchor="middle" fill="#9aa1ad">${esc(n.connectorName)}</text>`
      )
      .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#14161b"/>${lines}${circles}</svg>`
  }, [edges, nodes, width, height, bounds])

  const exportSvg = async () => {
    try {
      const res = await window.ww.file.exportText({
        content: svgText,
        defaultName: `${harness.name.replace(/[^\w-]+/g, '_') || 'harness'}-formboard.svg`,
        filterName: 'SVG',
        extensions: ['svg']
      })
      if (!res.canceled && res.path) toast(`Formboard exported to ${res.path}`, 'success')
    } catch (err) {
      toast(`Formboard export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] text-muted">
          {nodes.length} endpoints · 1 mm = 1 px · {Math.round(width)}×{Math.round(height)} mm
        </span>
        <button className="ww-btn ml-auto" onClick={exportSvg}>
          <FileDown size={14} /> Export SVG
        </button>
      </div>
      <div className="max-h-72 overflow-auto rounded border border-edge bg-panel p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: width, height: 'auto' }}
        >
          <rect width={width} height={height} fill="var(--color-bg)" />
          {edges.map((e, i) => (
            <line
              key={i}
              x1={e.a.x - bounds.minX}
              y1={e.a.y - bounds.minY}
              x2={e.b.x - bounds.minX}
              y2={e.b.y - bounds.minY}
              stroke="var(--color-accent)"
              strokeWidth={2}
            />
          ))}
          {edges.map((e, i) =>
            e.lengthMm != null ? (
              <text
                key={`l${i}`}
                x={(e.a.x + e.b.x) / 2 - bounds.minX}
                y={(e.a.y + e.b.y) / 2 - bounds.minY - 4}
                fontSize={11}
                textAnchor="middle"
                fill="var(--color-muted)"
              >
                {e.lengthMm} mm
              </text>
            ) : null
          )}
          {nodes.map((n, i) => (
            <g key={i}>
              <circle
                cx={n.x - bounds.minX}
                cy={n.y - bounds.minY}
                r={14}
                fill="var(--color-panelalt)"
                stroke="var(--color-accent)"
                strokeWidth={2}
              />
              <text
                x={n.x - bounds.minX}
                y={n.y - bounds.minY + 4}
                fontSize={10}
                textAnchor="middle"
                fill="var(--color-ink)"
              >
                {n.label.slice(0, 3)}
              </text>
              <text
                x={n.x - bounds.minX}
                y={n.y - bounds.minY + 28}
                fontSize={10}
                textAnchor="middle"
                fill="var(--color-muted)"
              >
                {n.connectorName}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
