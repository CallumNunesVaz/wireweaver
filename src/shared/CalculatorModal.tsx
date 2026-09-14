import { useState, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'
import { ampacityAwg, powerLost, voltageDrop } from '../model/calculators'
import { awgToMm2 } from '../model/wire'

const AWG_OPTIONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]

export function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('1')
  const [length, setLength] = useState('1')
  const [awg, setAwg] = useState(18)
  const [voltage, setVoltage] = useState('12')

  const results = useMemo(() => {
    const i = parseFloat(current) || 0
    const l = parseFloat(length) || 0
    const v = parseFloat(voltage) || 0
    // voltageDrop is linear in current, so 1 A gives the loop resistance.
    const resistance = voltageDrop(1, l, awg)
    const vDrop = voltageDrop(i, l, awg)
    const pLoss = powerLost(vDrop, i)
    const pct = v > 0 ? (vDrop / v) * 100 : 0
    const ampacity = ampacityAwg(awg)
    return { resistance, vDrop, pLoss, pct, ampacity, mm2: awgToMm2(awg) }
  }, [current, length, awg, voltage])

  const overAmpacity = Number.isFinite(results.ampacity) && (parseFloat(current) || 0) > results.ampacity

  return (
    <Modal title="Voltage Drop & Ampacity Calculator" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ww-label">Current (A)</label>
          <input
            type="number"
            className="ww-input"
            min={0}
            step={0.1}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label className="ww-label">System Voltage (V)</label>
          <input
            type="number"
            className="ww-input"
            min={0}
            step={0.1}
            value={voltage}
            onChange={(e) => setVoltage(e.target.value)}
          />
        </div>
        <div>
          <label className="ww-label">Wire Length (m, one way)</label>
          <input
            type="number"
            className="ww-input"
            min={0}
            step={0.01}
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </div>
        <div>
          <label className="ww-label">Wire Gauge (AWG)</label>
          <select
            className="ww-input"
            value={awg}
            onChange={(e) => setAwg(Number(e.target.value))}
          >
            {AWG_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a} AWG ({awgToMm2(a).toFixed(3)} mm²)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Loop Resistance</div>
          <div className="text-sm font-semibold">{results.resistance.toFixed(4)} Ω</div>
        </div>
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Voltage Drop</div>
          <div className="text-sm font-semibold">{results.vDrop.toFixed(3)} V</div>
          <div className="text-[10px] text-muted">{results.pct.toFixed(2)}%</div>
        </div>
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Power Loss</div>
          <div className="text-sm font-semibold">{results.pLoss.toFixed(3)} W</div>
        </div>
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Chassis Ampacity</div>
          <div className="text-sm font-semibold">{results.ampacity.toFixed(2)} A</div>
          <div className="text-[10px] text-muted">{results.mm2.toFixed(3)} mm²</div>
        </div>
      </div>

      {overAmpacity && (
        <div className="mt-3 flex items-start gap-2 rounded border border-[#e5484d]/40 bg-[#e5484d]/10 px-3 py-2 text-[11px] text-[#e5484d]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Current exceeds the {awg} AWG chassis-wiring ampacity ({results.ampacity.toFixed(2)} A).
        </div>
      )}
      {!overAmpacity && results.pct > 3 && (
        <div className="mt-3 flex items-start gap-2 rounded border border-[#c48a2f]/40 bg-[#c48a2f]/10 px-3 py-2 text-[11px] text-[#e0b25c]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Voltage drop exceeds 3% — consider a heavier gauge.
        </div>
      )}
    </Modal>
  )
}
