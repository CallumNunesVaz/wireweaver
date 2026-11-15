/**
 * CSV cell encoding shared by every export. Text that starts with a formula
 * trigger (= + - @ tab CR) is prefixed with an apostrophe so a part name from
 * a shared library cannot execute as a spreadsheet formula. Numbers are
 * written as numbers.
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}
