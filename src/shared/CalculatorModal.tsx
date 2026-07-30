import { useState, useMemo } from 'react'
import { Modal } from './Modal'

const AWG_TABLE: { awg: number; mm2: number; ohmsPerKm: number; diameterMm: number }[] = [
  { awg: 0, mm2: 53.49, ohmsPerKm: 0.322, diameterMm: 8.25 },
  { awg: 2, mm2: 33.62, ohmsPerKm: 0.513, diameterMm: 6.54 },
  { awg: 4, mm2: 21.15, ohmsPerKm: 0.815, diameterMm: 5.19 },
  { awg: 6, mm2: 13.30, ohmsPerKm: 1.30, diameterMm: 4.11 },
  { awg: 8, mm2: 8.37, ohmsPerKm: 2.06, diameterMm: 3.26 },
  { awg: 10, mm2: 5.26, ohmsPerKm: 3.28, diameterMm: 2.59 },
  { awg: 12, mm2: 3.31, ohmsPerKm: 5.21, diameterMm: 2.05 },
  { awg: 14, mm2: 2.08, ohmsPerKm: 8.28, diameterMm: 1.63 },
  { awg: 16, mm2: 1.31, ohmsPerKm: 13.17, diameterMm: 1.29 },
  { awg: 18, mm2: 0.823, ohmsPerKm: 20.95, diameterMm: 1.02 },
  { awg: 20, mm2: 0.518, ohmsPerKm: 33.31, diameterMm: 0.812 },
  { awg: 22, mm2: 0.326, ohmsPerKm: 52.96, diameterMm: 0.644 },
  { awg: 24, mm2: 0.205, ohmsPerKm: 84.22, diameterMm: 0.511 },
  { awg: 26, mm2: 0.129, ohmsPerKm: 133.86, diameterMm: 0.405 },
  { awg: 28, mm2: 0.0810, ohmsPerKm: 212.87, diameterMm: 0.321 },
  { awg: 30, mm2: 0.0509, ohmsPerKm: 338.58, diameterMm: 0.255 }
]

export function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('1')
  const [length, setLength] = useState('1')
  const [awg, setAwg] = useState(18)
  const [voltage, setVoltage] = useState('12')

  const awgEntry = AWG_TABLE.find((e) => e.awg === awg) ?? AWG_TABLE[0]

  const results = useMemo(() => {
    const i = parseFloat(current) || 0
    const l = parseFloat(length) || 0
    const v = parseFloat(voltage) || 0
    const r = (awgEntry.ohmsPerKm / 1000) * l * 2
    const vDrop = i * r
    const pLoss = i * vDrop
    const pct = v > 0 ? (vDrop / v) * 100 : 0
    return {
      resistanceOhms: r,
      voltageDropV: vDrop,
      powerLossW: pLoss,
      percentageDrop: pct
    }
  }, [current, length, awgEntry, voltage])

  return (
    <Modal title="Voltage Drop Calculator" onClose={onClose}>
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
          <label className="ww-label">Wire Length (m)</label>
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
            {AWG_TABLE.map((e) => (
              <option key={e.awg} value={e.awg}>
                {e.awg} AWG ({e.mm2.toFixed(3)} mm²)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Resistance</div>
          <div className="text-sm font-semibold">{results.resistanceOhms.toFixed(4)} Ω</div>
          <div className="text-[10px] text-muted">{awgEntry.ohmsPerKm.toFixed(1)} Ω/km</div>
        </div>
        <div className="rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Voltage Drop</div>
          <div className="text-sm font-semibold">{results.voltageDropV.toFixed(3)} V</div>
          <div className="text-[10px] text-muted">{results.percentageDrop.toFixed(2)}%</div>
        </div>
        <div className="col-span-2 rounded border border-edge bg-panelalt px-3 py-2">
          <div className="text-[10px] uppercase text-muted">Power Loss</div>
          <div className="text-sm font-semibold">{results.powerLossW.toFixed(3)} W</div>
        </div>
      </div>
    </Modal>
  )
}
