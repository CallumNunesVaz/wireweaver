const RESISTANCE_MILLIOHM_PER_M: Record<number, number> = {
  0: 0.3224, 1: 0.4066, 2: 0.5127, 3: 0.6465, 4: 0.8152,
  5: 1.028, 6: 1.296, 7: 1.634, 8: 2.061, 9: 2.599,
  10: 3.277, 11: 4.132, 12: 5.211, 13: 6.571, 14: 8.286,
  15: 10.45, 16: 13.17, 17: 16.61, 18: 20.95, 19: 26.42,
  20: 33.31, 21: 42.0, 22: 52.96, 23: 66.79, 24: 84.22,
  25: 106.2, 26: 133.9, 27: 168.8, 28: 212.9, 29: 268.5,
  30: 338.6, 31: 426.9, 32: 538.3, 33: 678.8, 34: 855.9,
  35: 1079, 36: 1361, 37: 1716, 38: 2164, 39: 2729,
  40: 3441
}

const AMPACITY_CHASSIS: Record<number, number> = {
  0: 245, 1: 211, 2: 181, 3: 158, 4: 135,
  5: 118, 6: 101, 7: 89, 8: 73, 9: 64,
  10: 55, 11: 47, 12: 41, 13: 35, 14: 32,
  15: 28, 16: 22, 17: 19, 18: 16, 19: 14,
  20: 11, 21: 9, 22: 7, 23: 4.7, 24: 3.5,
  25: 2.7, 26: 2.2, 27: 1.7, 28: 1.4, 29: 1.2,
  30: 0.86, 31: 0.7, 32: 0.53, 33: 0.43, 34: 0.33,
  35: 0.27, 36: 0.21, 37: 0.17, 38: 0.13, 39: 0.11,
  40: 0.09
}

const MM2_TO_AWG: [number, number][] = [
  [0.34, 22],
  [0.5, 20],
  [0.75, 18],
  [1.0, 17],
  [1.5, 15],
  [2.5, 13]
]

export function voltageDrop(
  currentAmps: number,
  lengthMeters: number,
  gaugeAwg: number
): number {
  if (!Number.isFinite(currentAmps) || currentAmps < 0) return NaN
  if (!Number.isFinite(lengthMeters) || lengthMeters < 0) return NaN
  const r = RESISTANCE_MILLIOHM_PER_M[gaugeAwg]
  if (!r) return NaN
  const resistance = (r / 1000) * lengthMeters * 2
  return currentAmps * resistance
}

export function ampacityAwg(gauge: number): number {
  if (!Number.isFinite(gauge) || gauge < 0) return NaN
  return AMPACITY_CHASSIS[gauge] ?? 0
}

export function powerLost(voltageDrop: number, currentAmps: number): number {
  if (!Number.isFinite(voltageDrop) || !Number.isFinite(currentAmps)) return NaN
  return voltageDrop * currentAmps
}

export function parseAwg(gaugeString: string): number | null {
  const awgMatch = gaugeString.match(/^(\d+)\s*AWG$/i)
  if (awgMatch) return parseInt(awgMatch[1], 10)

  const mm2Match = gaugeString.match(/^([\d.]+)\s*mm[2²]$/i)
  if (mm2Match) {
    const mm2 = parseFloat(mm2Match[1])
    for (const [threshold, awg] of MM2_TO_AWG) {
      if (mm2 <= threshold + 0.01) return awg
    }
  }

  return null
}
