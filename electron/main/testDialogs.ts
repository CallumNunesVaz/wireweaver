/**
 * Test-only seam for native Open/Save dialogs.
 *
 * Native file dialogs cannot be driven by Playwright, so the E2E harness fills
 * a FIFO queue on the main-process global and the wrapped dialog functions
 * answer from it instead of showing a native dialog. The returned paths still
 * flow through the normal grant logic (`grantFile` / `grantedDirs`) in
 * `index.ts`, so a test cannot bypass the path grant with this seam.
 *
 * Inert unless BOTH guards hold: `process.env.WW_E2E === '1'` AND the app is
 * unpackaged (`!app.isPackaged`). A packaged build therefore always shows real
 * dialogs and never consults the queue.
 */
import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'

export type TestDialogAnswer = { filePaths: string[] } | { canceled: true }

interface TestGlobal {
  __wwTestDialogs?: TestDialogAnswer[]
}

/** The queue lives on the main-process global so `electronApp.evaluate` can fill it. */
function queue(): TestDialogAnswer[] {
  const g = globalThis as unknown as TestGlobal
  if (!g.__wwTestDialogs) g.__wwTestDialogs = []
  return g.__wwTestDialogs
}

function enabled(): boolean {
  return process.env['WW_E2E'] === '1' && !app.isPackaged
}

export function showOpenDialog(win: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  if (!enabled()) return dialog.showOpenDialog(win, options)
  const answer = queue().shift()
  if (!answer || 'canceled' in answer) return Promise.resolve({ canceled: true, filePaths: [] })
  return Promise.resolve({ canceled: false, filePaths: answer.filePaths })
}

export function showSaveDialog(win: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  if (!enabled()) return dialog.showSaveDialog(win, options)
  const answer = queue().shift()
  if (!answer || 'canceled' in answer) return Promise.resolve({ canceled: true, filePath: '' })
  return Promise.resolve({ canceled: false, filePath: answer.filePaths[0] ?? '' })
}
