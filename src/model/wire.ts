import type { ColorCode, StripedColor } from './types'

/**
 * IEC 60757 color code sequence (ROY G BIV + grey/white/black).
 * Two-letter abbreviations per standard.
 */
export const IEC_COLORS = [
  'BN', 'RD', 'OG', 'YE', 'GN', 'BU', 'VT', 'GY', 'WH', 'BK'
]

/**
 * DIN 47100 color code sequence.
 */
export const DIN_COLORS = [
  'WH', 'BN', 'GN', 'YE', 'GY', 'PK', 'BU', 'RD', 'BK', 'VT',
  'GYPK', 'RDBU', 'WHGN', 'BNGN', 'WHYE', 'YEBN', 'WHGY', 'GYBN',
  'WHPK', 'PKBN', 'WHBU', 'BNBU', 'WHRD', 'BNRD', 'WHBK', 'BNBK',
  'GYGN', 'YEGY', 'PKGN', 'YEPK', 'GNBU', 'YEBU', 'GNRD', 'YERD'
]

/**
 * 25-pair color code (TEL / T568A/T568B subsets).
 * Major: WH RD BK YE VT  Minor: BU OG GN BN SL
 */
export const TEL_COLORS = (function () {
  const major = ['WH', 'RD', 'BK', 'YE', 'VT']
  const minor = ['BU', 'OG', 'GN', 'BN', 'SL']
  const out: string[] = []
  for (const ma of major) {
    for (const mi of minor) {
      out.push(`${ma}${mi}`)
    }
  }
  return out
})()

/** T568A 8P8C pinout colors */
export const T568A_COLORS = ['GNWT', 'GN', 'OGWH', 'BU', 'BUWH', 'OG', 'BNWH', 'BN']

/** T568B 8P8C pinout colors */
export const T568B_COLORS = ['OGWH', 'OG', 'GNWT', 'BU', 'BUWH', 'GN', 'BNWH', 'BN']

const CODE_MAP: Record<ColorCode, string[]> = {
  DIN: DIN_COLORS,
  IEC: IEC_COLORS,
  TEL: TEL_COLORS,
  T568A: T568A_COLORS,
  T568B: T568B_COLORS
}

/** Resolve a color code abbreviation to a CSS color. */
export function codeColor(abbr: string): string {
  const base = COLOR_ABBREV_MAP[abbr]
  if (base) return base
  const combined: Record<string, string> = {
    GYPK: '#999999', RDBU: '#8000ff', WHGN: '#00cc00', BNGN: '#895956',
    WHYE: '#ffff00', YEBN: '#ffff00', WHGY: '#999999', GYBN: '#895956',
    WHPK: '#ff66cc', PKBN: '#895956', WHBU: '#0066ff', BNBU: '#895956',
    WHRD: '#ff0000', BNRD: '#895956', WHBK: '#000000', BNBK: '#895956',
    GYGN: '#999999', YEGY: '#ffff00', PKGN: '#ff66cc', YEPK: '#ffff00',
    GNBU: '#00cc00', YEBU: '#ffff00', GNRD: '#00cc00', YERD: '#ffff00',
    GNWT: '#00cc00', OGWH: '#ff8000', BUWH: '#0066ff', BNWH: '#895956',
    BUOG: '#0066ff', GNBK: '#00cc00', BNSL: '#895956',
    SP: '#84878c' // silver / shield placeholder
  }
  return combined[abbr] ?? '#888888'
}

/** Get color sequence for a given code, repeating if needed. */
export function codeSequence(code: ColorCode, count: number): string[] {
  const seq = CODE_MAP[code] ?? []
  if (seq.length === 0) return []
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(seq[i % seq.length])
  }
  return out
}

// ---------- Gauge conversion ----------

/** Convert AWG to approximate mm² (cross-sectional area). */
export function awgToMm2(awg: number): number {
  if (awg <= 0) return NaN
  // Area = 0.012668 · 92^((36−n)/19.5); the /39 exponent is for diameter.
  return Math.round(0.012668 * Math.pow(92, (36 - awg) / 19.5) * 100) / 100
}

/** Convert mm² to approximate AWG. */
export function mm2ToAwg(mm2: number): number | null {
  if (mm2 <= 0) return null
  for (let awg = 48; awg >= 1; awg--) {
    if (awgToMm2(awg) >= mm2) return awg
  }
  return null
}

/** Parse gauge string like "22 AWG" or "0.34 mm2" and return both values. */
export function parseGauge(gauge: string): { awg?: number; mm2?: number; label: string } {
  const awgMatch = gauge.match(/^(\d+)\s*AWG$/i)
  if (awgMatch) {
    const awg = parseInt(awgMatch[1], 10)
    return { awg, mm2: awgToMm2(awg), label: `${awg} AWG` }
  }
  const mm2Match = gauge.match(/^([\d.]+)\s*mm[2²]$/i)
  if (mm2Match) {
    const mm2 = parseFloat(mm2Match[1])
    const awg = mm2ToAwg(mm2)
    return { mm2, awg: awg ?? undefined, label: `${mm2} mm²` }
  }
  return { label: gauge }
}

/** Format a gauge string showing both conversions. */
export function formatGauge(gauge?: string): string {
  if (!gauge) return ''
  const parsed = parseGauge(gauge)
  if (parsed.awg != null && parsed.mm2 != null) {
    // Lead with the unit the part was specified in; the other is approximate.
    return parsed.label.includes('AWG')
      ? `${parsed.awg} AWG (≈ ${parsed.mm2} mm²)`
      : `${parsed.mm2} mm² (≈ ${parsed.awg} AWG)`
  }
  return parsed.label
}

// ---------- Striped / banded colors ----------

/** Map color abbreviations to hex colors. */
export const COLOR_ABBREV_MAP: Record<string, string> = {
  BK: '#000000', WH: '#ffffff', GY: '#999999', PK: '#ff66cc',
  RD: '#ff0000', OG: '#ff8000', YE: '#ffff00', GN: '#00cc00',
  BU: '#0066ff', VT: '#8000ff', BN: '#895956', TQ: '#00ffff',
  LB: '#a0dfff', OL: '#708000', BG: '#ceb673', IV: '#f5f0d0',
  SL: '#708090', CU: '#d6775e', SN: '#aaaaaa', SR: '#84878c',
  GD: '#ffcf80'
}

/**
 * Parse a striped color string like "WH/GN", "BK/WH", "RD/BU" into a
 * StripedColor with hex values. Returns null if the format is unrecognised.
 */
export function parseStripedColor(colorString: string): StripedColor | null {
  const parts = colorString.split('/')
  if (parts.length !== 2) return null
  const primary = COLOR_ABBREV_MAP[parts[0].trim().toUpperCase()]
  const secondary = COLOR_ABBREV_MAP[parts[1].trim().toUpperCase()]
  if (!primary || !secondary) return null
  return { primary, secondary }
}

/** Render a striped color as a CSS linear-gradient for use in SVG or DOM. */
export function renderStripedColor(striped: StripedColor): string {
  return `repeating-linear-gradient(45deg, ${striped.primary} 0px, ${striped.primary} 6px, ${striped.secondary} 6px, ${striped.secondary} 12px)`
}
