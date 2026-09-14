import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileText, Printer, Share2 } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { toast } from '../shared/toast'
import { useLibraryStore, selectLibraryLike } from '../stores/libraryStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import {
  cutlist,
  cutlistCsv,
  netlist,
  netlistCsv,
  wiringTableAll,
  wiringCsv
} from '../model/reports'
import { buildHtmlReport } from '../model/report-html'
import { wirevizYaml } from '../model/wireviz'
import { buildBom, bomTotals } from '../model/bom'
import { convertBomTotals } from '../model/fx'
import { formatMoney } from '../model/currency'
import { FormboardView } from './FormboardView'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Tab = 'wiring' | 'cutlist' | 'netlist' | 'formboard'

/** Capture the assembly canvas as a PNG data URL; undefined when unavailable. */
async function captureAssemblyPng(): Promise<string | undefined> {
  try {
    const el = document.querySelector('.react-flow:not([style*="position: fixed"]) .react-flow__viewport') as HTMLElement | null
    if (!el) return undefined
    const { toPng } = await import('html-to-image')
    return await toPng(el, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#14161b' })
  } catch {
    return undefined
  }
}

export function ReportsModal() {
  const close = useUiStore((s) => s.toggleReports)
  const project = useProjectStore((s) => s.project)
  const setProjectMeta = useProjectStore((s) => s.setProjectMeta)
  const parts = useLibraryStore((s) => s.parts)
  const templates = useLibraryStore((s) => s.templates)
  const lib = useMemo(() => selectLibraryLike({ parts, templates }), [parts, templates])

  const [tab, setTab] = useState<Tab>('wiring')
  const [slackMm, setSlackMm] = useState(50)
  const [wirevizHarnessId, setWirevizHarnessId] = useState(
    project.harnesses[0]?.id ?? ''
  )
  useEffect(() => {
    if (!project.harnesses.find((h) => h.id === wirevizHarnessId)) {
      setWirevizHarnessId(project.harnesses[0]?.id ?? '')
    }
  }, [project.harnesses, wirevizHarnessId])

  const formboardHarnessId = wirevizHarnessId
  const formboardHarness = project.harnesses.find((h) => h.id === formboardHarnessId)

  const wiringRows = useMemo(() => wiringTableAll(lib, project), [lib, project])
  const cutRows = useMemo(() => cutlist(lib, project, slackMm), [lib, project, slackMm])
  const nets = useMemo(() => netlist(lib, project), [lib, project])

  // BOM totals + optional FX conversion.
  const bomRows = useMemo(() => buildBom(project, lib), [lib, project])
  const totals = useMemo(() => bomTotals(bomRows), [bomRows])
  const [targetCurrency, setTargetCurrency] = useState('USD')
  const [converted, setConverted] = useState<{ amount: number; rate: number } | null>(null)
  const [converting, setConverting] = useState(false)

  const doConvert = async () => {
    setConverting(true)
    try {
      const res = await convertBomTotals(bomRows, targetCurrency)
      if (!res) {
        toast('Could not fetch exchange rates (offline?).', 'error')
        return
      }
      setConverted({ amount: res.convertedCost, rate: res.rate })
    } finally {
      setConverting(false)
    }
  }

  const fileBase = project.name || 'wireweaver'

  const doExport = async (
    content: string,
    defaultName: string,
    filterName: string,
    extensions: string[]
  ) => {
    try {
      const res = await window.ww.file.exportText({
        content,
        defaultName,
        filterName,
        extensions
      })
      if (!res.canceled && res.path) toast(`Exported to ${res.path}`, 'success')
    } catch (err) {
      toast(`Export failed: ${errMessage(err)}`, 'error')
    }
  }

  const exportHtml = async () => {
    const diagramPng = await captureAssemblyPng()
    await doExport(
      buildHtmlReport(lib, project, { diagramPng, slackMm }),
      `${fileBase}-report.html`,
      'HTML Report',
      ['html']
    )
  }

  const exportPdf = async () => {
    try {
      const diagramPng = await captureAssemblyPng()
      const html = buildHtmlReport(lib, project, { diagramPng, slackMm })
      const res = await window.ww.report.exportPdf(html, `${fileBase}-report.pdf`)
      if (!res.canceled && res.path) toast(`PDF exported to ${res.path}`, 'success')
    } catch (err) {
      toast(`PDF export failed: ${errMessage(err)}`, 'error')
    }
  }

  const exportWireviz = async () => {
    const h = project.harnesses.find((x) => x.id === wirevizHarnessId)
    if (!h) return
    await doExport(
      wirevizYaml(lib, project, h),
      `${h.name.replace(/[^\w-]+/g, '_') || 'harness'}.yml`,
      'WireViz YAML',
      ['yml', 'yaml']
    )
  }

  const th = 'border-b border-edge px-2 py-1 text-left font-semibold text-muted'
  const td = 'border-b border-edge/50 px-2 py-1'

  return (
    <Modal title="Reports & Exports" onClose={close} wide>
      {/* Title block */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Revision
          <input
            className="ww-input mt-1 w-full"
            value={project.revision ?? ''}
            onChange={(e) => setProjectMeta({ revision: e.target.value })}
            placeholder="e.g. A1"
          />
        </label>
        <label className="text-xs text-muted">
          Author
          <input
            className="ww-input mt-1 w-full"
            value={project.author ?? ''}
            onChange={(e) => setProjectMeta({ author: e.target.value })}
            placeholder="who drew this"
          />
        </label>
        <label className="col-span-2 text-xs text-muted">
          Description
          <input
            className="ww-input mt-1 w-full"
            value={project.description ?? ''}
            onChange={(e) => setProjectMeta({ description: e.target.value })}
            placeholder="shown in the report title block"
          />
        </label>
      </div>

      {/* Export buttons */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          className="ww-btn"
          onClick={() => doExport(wiringCsv(wiringRows), `${fileBase}-wiring.csv`, 'CSV', ['csv'])}
        >
          <FileDown size={14} /> Wiring CSV
        </button>
        <button
          className="ww-btn"
          onClick={() => doExport(cutlistCsv(cutRows), `${fileBase}-cutlist.csv`, 'CSV', ['csv'])}
        >
          <FileDown size={14} /> Cutlist CSV
        </button>
        <button
          className="ww-btn"
          onClick={() => doExport(netlistCsv(nets), `${fileBase}-netlist.csv`, 'CSV', ['csv'])}
        >
          <FileDown size={14} /> Netlist CSV
        </button>
        <button className="ww-btn" onClick={exportHtml}>
          <FileText size={14} /> HTML Report
        </button>
        <button className="ww-btn" onClick={exportPdf}>
          <Printer size={14} /> PDF Report
        </button>
        <span className="mx-1 h-5 w-px bg-edge" />
        <select
          className="ww-input"
          value={wirevizHarnessId}
          onChange={(e) => setWirevizHarnessId(e.target.value)}
        >
          {project.harnesses.length === 0 && <option value="">no harnesses</option>}
          {project.harnesses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <button
          className="ww-btn"
          onClick={exportWireviz}
          disabled={project.harnesses.length === 0}
          title="Export the selected harness as a WireViz YAML file"
        >
          <Share2 size={14} /> WireViz YAML
        </button>
      </div>

      {/* Preview tabs */}
      <div className="mb-2 flex items-center gap-1">
        {(['wiring', 'cutlist', 'netlist', 'formboard'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`rounded px-3 py-1 text-xs capitalize ${
              tab === t ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-panelalt'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        {tab === 'cutlist' && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Slack per cut (mm)
            <input
              type="number"
              min={0}
              className="ww-input w-20"
              value={slackMm}
              onChange={(e) => setSlackMm(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        )}
      </div>

      {tab === 'formboard' ? (
        formboardHarness ? (
          <FormboardView lib={lib} project={project} harness={formboardHarness} />
        ) : (
          <div className="rounded border border-edge px-3 py-6 text-center text-xs text-muted">
            No harnesses to lay out.
          </div>
        )
      ) : (
      <div className="max-h-72 overflow-auto rounded border border-edge">
        {tab === 'wiring' && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {['Harness', 'Wire', 'From', 'Pin', 'To', 'Pin', 'Color', 'Gauge', 'Len (mm)'].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wiringRows.map((r, i) => (
                <tr key={i}>
                  <td className={td}>{r.harness}</td>
                  <td className={td}>{r.wire}</td>
                  <td className={td}>{r.fromDevice} · {r.fromPort} {r.fromSignal && <span className="text-muted">({r.fromSignal})</span>}</td>
                  <td className={td}>{r.fromPin}</td>
                  <td className={td}>{r.toDevice} · {r.toPort} {r.toSignal && <span className="text-muted">({r.toSignal})</span>}</td>
                  <td className={td}>{r.toPin}</td>
                  <td className={td}>{r.color}</td>
                  <td className={td}>{r.gauge}</td>
                  <td className={td}>{r.lengthMm ?? '—'}</td>
                </tr>
              ))}
              {wiringRows.length === 0 && (
                <tr><td className={`${td} text-muted`} colSpan={9}>No wires yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'cutlist' && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {['Wire Part', 'Gauge', 'Color', 'Cut Length (mm)', 'Qty'].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cutRows.map((r, i) => (
                <tr key={i}>
                  <td className={td}>{r.wirePart}</td>
                  <td className={td}>{r.gauge}</td>
                  <td className={td}>{r.color}</td>
                  <td className={td}>{r.cutLengthMm ?? 'unknown'}</td>
                  <td className={td}>{r.quantity}</td>
                </tr>
              ))}
              {cutRows.length === 0 && (
                <tr><td className={`${td} text-muted`} colSpan={5}>No wires yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'netlist' && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {['Net', 'Device', 'Port', 'Pin', 'Signal'].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nets.flatMap((net) =>
                net.nodes.map((n, i) => (
                  <tr key={`${net.name}-${i}`}>
                    <td className={td}>{i === 0 ? net.name : ''}</td>
                    <td className={td}>{n.device}</td>
                    <td className={td}>{n.port}</td>
                    <td className={td}>{n.pin}</td>
                    <td className={td}>{n.signal}</td>
                  </tr>
                ))
              )}
              {nets.length === 0 && (
                <tr><td className={`${td} text-muted`} colSpan={5}>No nets yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* BOM totals with optional FX conversion */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-edge bg-panelalt px-3 py-2 text-xs">
        <span className="font-medium">BOM totals</span>
        <span className="text-muted">Weight {totals.weightGrams.toFixed(1)} g</span>
        {[...totals.costByCurrency].map(([cur, amount]) => (
          <span key={cur} className="text-muted">
            {formatMoney({ amount, currency: cur })}
          </span>
        ))}
        {totals.costByCurrency.size === 0 && (
          <span className="text-muted">No priced parts.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select
            className="ww-input w-20"
            value={targetCurrency}
            onChange={(e) => {
              setTargetCurrency(e.target.value)
              setConverted(null)
            }}
          >
            {['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'CHF'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="ww-btn" onClick={doConvert} disabled={converting}>
            {converting ? 'Converting…' : 'Convert'}
          </button>
          {converted && (
            <span className="text-accent font-medium">
              ≈ {formatMoney({ amount: converted.amount, currency: targetCurrency })}
              <span className="ml-1 text-[10px] text-muted">@ {converted.rate.toFixed(4)}</span>
            </span>
          )}
        </div>
      </div>
    </Modal>
  )
}
