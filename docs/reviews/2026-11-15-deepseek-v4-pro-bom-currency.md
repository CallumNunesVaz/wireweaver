# DeepSeek delegation — bom-currency (2026-11-15)

Model: deepseek/deepseek-v4-pro via opencode (`--agent build`, branch `deepseek/bom-currency`).

## Review outcome (Claude)

- **Accepted.** `toCsv(rows, { currency, rates })` adds converted unit/extended columns, a converted grand total, rate date/source and a "Not converted" footer; JPY/KRW round to whole units; the Reports dialog exports a converted BOM CSV and falls back to per-currency when offline. Unconverted output is unchanged.
- **Amended (Claude):** the converted grand total was summed from unrounded values, so it could differ by a cent from the column of rounded line values — it is now the sum of the rounded lines (regression test added).
- **Found while verifying (pre-existing bug, fixed):** `api.frankfurter.app` now 301-redirects to `api.frankfurter.dev/v1/latest`, which the packaged app's CSP (`connect-src … api.frankfurter.app`) blocks — currency conversion silently returned nothing on `main`. The endpoint and CSP now use `api.frankfurter.dev`. Verified in the built app: `main` → no result; this branch → "≈ €190.34".
- Verified: typecheck, lint, 284 unit tests, E2E 8/8.

## Task prompt

# Task: currency conversion in the BOM CSV export

The BOM CSV (`src/model/bom.ts` → `toCsv`, exported from the Tools menu / Ctrl+B and the
Reports dialog) totals each currency separately. Conversion exists only as a display in
`src/reports/ReportsModal.tsx` (`convertBomTotals` in `src/model/fx.ts`, rates fetched
from api.frankfurter.app, which the CSP allows).

1. Add an optional conversion to the CSV: `toCsv(rows, { currency, rates? })` adds
   "Unit Cost (<CUR>)" and "Ext Cost (<CUR>)" columns and a single converted grand total,
   keeping the original currency columns. Rows whose currency has no rate show an empty
   converted cell and are listed in a footer line ("Not converted: …"). Use `decimal.js`
   (already a dependency) for money arithmetic; round to 2 dp (0 dp for JPY — check
   `src/model/currency.ts` for minor-unit info and reuse it).
2. Record the rate date and source in the footer (frankfurter returns `date`; extend
   `fetchRates` to return it — keep its cache and 5 s timeout; flag uncertain API shape).
3. Reports dialog: a "BOM CSV" export button using the currency picker already there
   (convert when a target currency other than "per currency" is chosen; offline → toast an
   error and offer the unconverted export). Ctrl+B keeps exporting the unconverted CSV.
4. Keep CSV cells formula-safe via `csvCell` (`src/model/csv.ts`).
5. Tests: conversion maths (incl. JPY rounding and missing rate), footer, unchanged output
   when no conversion is requested (existing `tests/bom.test.ts` must still pass), using
   injected rates (no network in unit tests).

Acceptance: typecheck, lint, unit tests, build pass; no network access in tests.



## DeepSeek final message (verbatim)

Done. Implemented BOM CSV currency conversion across `bom.ts`, `fx.ts`, `currency.ts`, `ReportsModal.tsx`, plus tests.

Key changes:
- `toCsv(rows, { currency, rates?, rateDate?, rateSource? })` adds `Unit Cost (CUR)`/`Ext Cost (CUR)` columns, a single converted total, and a `Not converted: …` footer line — using decimal.js, 2 dp (0 dp for JPY via new `currencyDecimals`). Unconverted output is byte-identical.
- `fetchRates()` now returns `{ date, source, rates }` with cache/5s timeout preserved; shape flagged as uncertain.
- Reports dialog gained a "BOM CSV" button using the existing picker (now defaults to "per currency"); offline → error toast + `confirmDialog` offering unconverted export. Ctrl+B still exports unconverted.

Verification: `typecheck` ✓, `lint` (0 errors; 10 pre-existing warnings elsewhere) ✓, `test` (283 passed) ✓, `build` ✓, `test:e2e` (8 passed) ✓. Notes written to `DEEPSEEK_NOTES.md`.

## DeepSeek build notes (verbatim)

## DeepSeek Notes — BOM CSV currency conversion

### What changed (by file)

#### `src/model/currency.ts`
- Added `currencyDecimals(currency)` (plus a `ZERO_DECIMAL_CURRENCIES` set for `JPY` and `KRW`).
  The task said to "check `src/model/currency.ts` for minor-unit info and reuse it", but the file
  contained no minor-unit info, so I added it here. Returns `0` for JPY/KRW, `2` otherwise.

#### `src/model/fx.ts`
- Introduced `interface FxRates { date; source; rates }` and changed `fetchRates()` to return
  `FxRates | null` instead of a bare `Record<string, number>`. The 5 s timeout, AbortController
  and in-memory cache are unchanged; the cache now stores the whole `FxRates` object.
- `date` is read from frankfurter's `date` field (ISO string; `''` when absent). `source` is a
  constant `'Frankfurter (api.frankfurter.app)'`.
- The response is parsed defensively (the exact frankfurter shape is flagged as uncertain in a
  comment): only numeric, finite rate values are copied, and a missing/malformed payload degrades
  to an empty `rates` map rather than throwing.
- `convertBomTotals` updated to read `fetched.rates`; its return shape is unchanged so the
  existing Reports-modal display keeps working.

#### `src/model/bom.ts`
- Added `interface ToCsvOptions { currency?; rates?; rateDate?; rateSource? }`.
- `toCsv(rows, options = {})` now:
  - emits `Unit Cost (<CUR>)` / `Ext Cost (<CUR>)` columns only when both `currency` and `rates`
    are provided;
  - converts each priced row via decimal.js (`amount / fromRate * targetRate`), rounding to
    `currencyDecimals(target)` (2 dp, 0 dp for JPY);
  - leaves an empty converted cell for rows whose currency has no rate, and collects those names;
  - keeps the original per-currency columns and per-currency total lines;
  - appends a single `Converted total (<CUR>)` line (exact sum, rounded at the end), plus
    `Rates as of` / `Rate source` footer lines and a `Not converted: …` line when applicable.
- `toCsv(rows)` with no options produces byte-identical output to the previous implementation
  (existing `tests/bom.test.ts` cases still pass).
- `exportBomCsv` (used by Ctrl+B) is unchanged and still exports the unconverted CSV.

#### `src/reports/ReportsModal.tsx`
- Added a `TARGET_CURRENCIES` module constant and a "per currency" `<option value="">` as the
  new default for the existing currency picker (was `'USD'`).
- Added a `BOM CSV` export button (next to the picker/Convert button) that:
  - exports `toCsv(bomRows)` unconverted when "per currency" is selected;
  - otherwise calls `fetchRates()` and exports `toCsv(bomRows, { currency, rates, rateDate, rateSource })`;
  - on offline/missing-rate, toasts an error and offers the unconverted export via `confirmDialog`.
- The inline "Convert" button is disabled while "per currency" is selected.

### Design decisions
- Kept `toCsv` conversion math inline (rather than sharing a helper with `convertBomTotals`) so
  the CSV rounding (fixed decimal places via `toFixed`) and per-cell unit/extended values stay
  explicit and independently testable. `convertBomTotals` remains the "display" path and returns
  an unrounded `number`.
- Converted money cells are written as fixed-decimal strings (`"10.00"`, `"15"`) rather than
  `Intl` currency strings, matching the "round to 2 dp / 0 dp for JPY" requirement; they go through
  `csvCell` for formula-safety.
- `Not converted:` footer uses the part `name` (single CSV cell) so the list stays one readable
  cell; rows with no cost are deliberately not listed there (they have nothing to convert).

### Guesses / uncertainties
- Frankfurter's exact JSON shape (`{ amount, base, date, rates }`) is asserted only loosely; this
  is flagged in a comment and guarded so a changed shape fails soft (no throw).
- `currencyDecimals` treats `KRW` as 0-dp alongside `JPY` (ISO 4217 reality); the task only
  explicitly required JPY. Harmless, but noted.
- The converted total rounds the *exact* sum of extended amounts, so a displayed rounded unit cost
  × qty can differ from the displayed extended cost by a cent in edge cases (standard rounding).

### Known risks
- The `date`/`source` are only meaningful when rates come from `fetchRates`; `toCsv` accepts them
  as arbitrary strings, so other callers must supply them (they are optional).

### Verification (final output)
- `npm run typecheck` — passed (node + web).
- `npm run lint` — 0 errors, 10 warnings (pre-existing in `scripts/import-ecu-templates/index.ts`,
  unrelated to this change).
- `npm test` — 27 passed | 1 skipped (files); 283 passed | 8 skipped (tests).
- `npm run build` — passed.
- `npm run test:e2e` — 8 passed (smoke suite against the built `out/`).
