import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promises as fs, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import type {
  IpcArgs,
  IpcChannel,
  IpcEvents,
  IpcResult,
  MenuCommand,
  RecentEntry,
  ThemePreference
} from '../../src/ipc/contract'

const isDev = !app.isPackaged

// Stable app name so userData resolves to a WireWeaver folder even when run unpackaged.
app.setName('WireWeaver')

// One instance owns the library and recovery files; a second launch hands its
// file argument to the first and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// The ww:// scheme serves the packaged renderer (ww://app/…) and library images
// (ww://image/…). A registered scheme gives the app a real origin, so a strict
// CSP with `script-src 'self'` works and Chromium can cache images.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ww', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const APP_ORIGIN = 'ww://app'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

// ---------- Settings & storage paths ----------

interface AppSettings {
  libraryPath?: string
  theme?: ThemePreference
}

const DEFAULT_LIBRARY_DIR = join(app.getPath('userData'), 'library')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const recoveryFile = () => join(app.getPath('userData'), 'recovery.wwv')
const recentFile = () => join(app.getPath('userData'), 'recent-projects.json')

let settings: AppSettings = {}

function libraryDir(): string {
  return settings.libraryPath ?? DEFAULT_LIBRARY_DIR
}
const imagesDir = () => join(libraryDir(), 'images')
const partsFile = () => join(libraryDir(), 'parts.json')
const templatesFile = () => join(libraryDir(), 'pinout-templates.json')

/** Bundled starter packs (repo data/ in dev, resources in prod). */
function packsDir(): string {
  return isDev ? join(app.getAppPath(), 'data') : join(process.resourcesPath, 'data')
}

async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  settings = { ...settings, ...patch }
  await writeJsonAtomic(settingsFile(), settings)
}

// ---------- File helpers ----------

/** Write via a unique temp file + fsync + rename so a crash never leaves a torn file. */
async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(data, null, 2))
}

type ReadOutcome<T> = { ok: true; data: T } | { ok: false; missing: boolean; error: string }

/** Read JSON, telling "missing" apart from "unreadable/corrupt". */
async function readJsonFile<T>(file: string): Promise<ReadOutcome<T>> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, missing, error: missing ? 'File not found.' : String((e as Error).message) }
  }
  try {
    return { ok: true, data: JSON.parse(raw) as T }
  } catch (e) {
    return { ok: false, missing: false, error: `Not valid JSON: ${(e as Error).message}` }
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const r = await readJsonFile<T>(file)
  return r.ok ? r.data : fallback
}

/** Keep a damaged file aside instead of letting the next save overwrite it. */
async function quarantine(file: string): Promise<string> {
  const dest = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await fs.copyFile(file, dest).catch(() => {})
  return dest
}

// ---------- Path grants ----------
//
// The renderer may only open or write project files the user chose in a
// native dialog, picked from Recent, or opened from the OS. A compromised
// renderer therefore cannot read or overwrite arbitrary files.

const grantedFiles = new Set<string>()
const grantedDirs = new Set<string>()

function grantFile(p: string): string {
  const abs = resolve(p)
  grantedFiles.add(abs)
  return abs
}

function requireGrantedFile(p: unknown): string {
  if (typeof p !== 'string' || !grantedFiles.has(resolve(p))) {
    throw new Error('Access to this file was not granted. Use Open or Save As.')
  }
  return resolve(p)
}

// ---------- ww:// protocol ----------

const MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

async function fileResponse(file: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const buf = await fs.readFile(file)
  const ext = extname(file).slice(1).toLowerCase()
  return new Response(buf, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  })
}

const IMAGE_NAME = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/i
const thumbName = (imageName: string) => imageName.replace(/\.[a-z0-9]+$/i, '.thumb.webp')

function registerProtocol(): void {
  const rendererDir = join(__dirname, '../renderer')
  protocol.handle('ww', async (request) => {
    try {
      const url = new URL(request.url)
      // ww://image/<full|thumb>/<sha256>.<ext>
      if (url.host === 'image') {
        const [, variant, name] = url.pathname.split('/')
        if (!name || !IMAGE_NAME.test(name)) return new Response('Bad request', { status: 400 })
        const sandboxed = { 'content-security-policy': "default-src 'none'; sandbox" }
        if (variant === 'thumb') {
          try {
            return await fileResponse(join(imagesDir(), thumbName(name)), sandboxed)
          } catch {
            // No thumbnail (older import) — fall through to the original.
          }
        }
        return await fileResponse(join(imagesDir(), name), sandboxed)
      }
      // ww://app/… — the built renderer
      if (url.host === 'app') {
        const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
        const file = join(rendererDir, rel)
        const outside = relative(rendererDir, file)
        if (outside.startsWith('..') || isAbsolute(outside)) {
          return new Response('Forbidden', { status: 403 })
        }
        return await fileResponse(file)
      }
      return new Response('Not found', { status: 404 })
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return new Response('Not found', { status: 404 })
      }
      return new Response('Internal error', { status: 500 })
    }
  })
}

// ---------- Window ----------

let mainWindow: BrowserWindow | null = null
let projectDirty = false
let allowClose = false
/** A .wwv to open once the renderer is ready (OS launch / second instance). */
let pendingOpenFile: string | null = null

function rendererOrigin(): string {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return isDev && dev ? new URL(dev).origin : APP_ORIGIN
}

function isAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.origin === rendererOrigin() || `${u.protocol}//${u.host}` === APP_ORIGIN
  } catch {
    return false
  }
}

/** Open only real web links in the OS browser. */
function openExternalSafe(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  void shell.openExternal(u.toString())
  return true
}

function windowBackground(): string {
  const pref = settings.theme ?? 'system'
  const dark = pref === 'dark' || (pref === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#14161b' : '#f5f6fa'
}

function send<E extends keyof IpcEvents>(event: E, payload?: IpcEvents[E]): void {
  mainWindow?.webContents.send(event, payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: windowBackground(),
    show: false,
    autoHideMenuBar: true,
    title: 'WireWeaver',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (e) => {
    if (!projectDirty || allowClose) return
    e.preventDefault()
    void dialog
      .showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'Unsaved changes',
        message: 'Save changes to this project before closing?',
        detail: "If you don't save, your changes will be lost.",
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      .then(({ response }) => {
        if (response === 0) {
          // The renderer saves (possibly via Save As) and then calls closeAfterSave.
          send('app:saveAndClose')
        } else if (response === 1) {
          // The user chose to discard, so don't offer this work back on next launch.
          rmSync(recoveryFile(), { force: true })
          allowClose = true
          mainWindow?.close()
        }
      })
  })

  // Never navigate the app window away from the app, never open child windows.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault()
      openExternalSafe(url)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/`)
  }
}

function buildMenu(): void {
  const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    // The renderer owns these shortcuts (it knows about focus and overlays),
    // so the menu shows them without capturing the keystroke.
    registerAccelerator: false,
    click: () => send('menu:command', command)
  })
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        cmd('New Project', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('Reports & Exports…', 'reports', 'CmdOrCtrl+R'),
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        cmd('Command Palette…', 'palette', 'CmdOrCtrl+K'),
        cmd('Library Manager', 'library', 'CmdOrCtrl+L'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [cmd('Documentation', 'docs', 'F1'), cmd('Keyboard Shortcuts', 'shortcuts')]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** A .wwv path from argv (file association / "Open with"). */
function fileFromArgv(argv: string[]): string | null {
  const hit = argv.slice(1).find((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.wwv'))
  return hit ? resolve(hit) : null
}

let rendererReady = false

function openFromOs(path: string): void {
  const abs = grantFile(path)
  if (rendererReady) send('app:openFile', abs)
  else pendingOpenFile = abs
}

// ---------- IPC ----------

/** Register a typed handler that only answers the app's own window. */
function handle<C extends IpcChannel>(
  channel: C,
  fn: (e: IpcMainInvokeEvent, ...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>
): void {
  ipcMain.handle(channel, (e, ...args) => {
    const url = e.senderFrame?.url ?? ''
    if (e.sender !== mainWindow?.webContents || !isAppUrl(url)) {
      throw new Error(`Rejected IPC "${channel}" from ${url || 'unknown sender'}`)
    }
    return fn(e, ...(args as IpcArgs<C>))
  })
}

const isString = (v: unknown): v is string => typeof v === 'string'

async function readRecent(): Promise<RecentEntry[]> {
  const list = await readJson<RecentEntry[]>(recentFile(), [])
  return Array.isArray(list)
    ? list.filter((e) => e && isString(e.path) && isString(e.name)).slice(0, 10)
    : []
}

async function registerIpc(): Promise<void> {
  settings = await readJson<AppSettings>(settingsFile(), {})

  // Recent projects used to live inside the library folder; migrate once.
  const legacyRecent = join(libraryDir(), 'recent-projects.json')
  if (!(await readJsonFile(recentFile())).ok) {
    const legacy = await readJsonFile<RecentEntry[]>(legacyRecent)
    if (legacy.ok) await writeJsonAtomic(recentFile(), legacy.data)
  }

  handle('library:load', async () => {
    await fs.mkdir(imagesDir(), { recursive: true })
    const parts = await readJsonFile<unknown>(partsFile())
    const templates = await readJsonFile<unknown>(templatesFile())
    const problems: string[] = []
    for (const [label, file, r] of [
      ['parts.json', partsFile(), parts],
      ['pinout-templates.json', templatesFile(), templates]
    ] as const) {
      if (!r.ok && !r.missing) {
        const kept = await quarantine(file)
        problems.push(`${label}: ${r.error} A copy was kept at ${kept}.`)
      } else if (r.ok && !Array.isArray(r.data)) {
        const kept = await quarantine(file)
        problems.push(`${label}: unexpected content. A copy was kept at ${kept}.`)
      }
    }
    if (problems.length) {
      return { parts: [], templates: [], isNew: false, error: problems.join('\n') }
    }
    return {
      parts: parts.ok ? (parts.data as never) : [],
      templates: templates.ok ? (templates.data as never) : [],
      isNew: !parts.ok && parts.missing
    }
  })

  handle('library:saveParts', async (_e, parts) => {
    if (!Array.isArray(parts)) throw new Error('Invalid parts payload')
    await fs.mkdir(imagesDir(), { recursive: true })
    await writeJsonAtomic(partsFile(), parts)
    return true
  })

  handle('library:saveTemplates', async (_e, templates) => {
    if (!Array.isArray(templates)) throw new Error('Invalid templates payload')
    await fs.mkdir(imagesDir(), { recursive: true })
    await writeJsonAtomic(templatesFile(), templates)
    return true
  })

  handle('library:export', async (_e, data) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Library',
      defaultPath: 'wireweaver-library.wwlib',
      filters: [{ name: 'WireWeaver Library', extensions: ['wwlib'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    await writeJsonAtomic(res.filePath, data)
    return { canceled: false, path: res.filePath }
  })

  handle('library:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Library',
      properties: ['openFile'],
      filters: [{ name: 'WireWeaver Library', extensions: ['wwlib'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const r = await readJsonFile(res.filePaths[0])
    return r.ok
      ? { canceled: false, path: res.filePaths[0], data: r.data }
      : { canceled: false, path: res.filePaths[0], error: r.error }
  })

  // Store an image (and optional thumbnail) by content hash. Raster formats
  // only: SVG can carry script and is rejected.
  handle('image:import', async (_e, payload) => {
    if (!payload || !isString(payload.dataUrl)) throw new Error('Unsupported image data')
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(payload.dataUrl)
    const ext = match ? IMAGE_MIME[match[1].toLowerCase()] : undefined
    if (!match || !ext) throw new Error('Only PNG, JPEG, WebP and GIF images are supported.')
    const buf = Buffer.from(match[2], 'base64')
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 20 MB.')
    await fs.mkdir(imagesDir(), { recursive: true })
    const filename = `${createHash('sha256').update(buf).digest('hex')}.${ext}`
    const dest = join(imagesDir(), filename)
    try {
      await fs.access(dest)
    } catch {
      await writeFileAtomic(dest, buf)
    }
    const tmatch = isString(payload.thumbDataUrl)
      ? /^data:image\/webp;base64,([a-z0-9+/=]+)$/i.exec(payload.thumbDataUrl)
      : null
    if (tmatch) {
      const thumb = Buffer.from(tmatch[1], 'base64')
      if (thumb.length <= MAX_IMAGE_BYTES) {
        await writeFileAtomic(join(imagesDir(), thumbName(filename)), thumb)
      }
    }
    return { hash: filename }
  })

  handle('project:save', async (_e, args) => {
    let target: string
    if (args?.path) {
      target = requireGrantedFile(args.path)
    } else {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save WireWeaver Project',
        defaultPath: 'project.wwv',
        filters: [{ name: 'WireWeaver Project', extensions: ['wwv'] }]
      })
      if (res.canceled || !res.filePath) return { canceled: true }
      target = grantFile(res.filePath)
    }
    await writeJsonAtomic(target, args.data)
    return { canceled: false, path: target }
  })

  handle('project:open', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open WireWeaver Project',
      properties: ['openFile'],
      filters: [{ name: 'WireWeaver Project', extensions: ['wwv'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const path = grantFile(res.filePaths[0])
    const r = await readJsonFile(path)
    return r.ok ? { canceled: false, path, data: r.data } : { canceled: false, path, error: r.error }
  })

  handle('project:openPath', async (_e, path) => {
    const abs = requireGrantedFile(path)
    const r = await readJsonFile(abs)
    return r.ok
      ? { canceled: false, path: abs, data: r.data }
      : { canceled: false, path: abs, error: r.error }
  })

  handle('project:setDirty', async (_e, dirty) => {
    projectDirty = dirty === true
  })

  // Crash recovery: a rolling autosave outside the library so unsaved work
  // survives a hard quit. Cleared on explicit save / new / open / discard.
  handle('project:autosave', async (_e, args) => {
    const path = isString(args?.path) && grantedFiles.has(resolve(args.path)) ? resolve(args.path) : undefined
    await writeJsonAtomic(recoveryFile(), { savedAt: Date.now(), data: args?.data, path })
    return true
  })

  handle('project:getRecovery', async () => {
    const rec = await readJson<{ savedAt: number; data: unknown; path?: string } | null>(recoveryFile(), null)
    if (!rec || !rec.data) return { exists: false }
    const path = isString(rec.path) ? grantFile(rec.path) : undefined
    return { exists: true, savedAt: rec.savedAt, data: rec.data, path }
  })

  handle('project:clearRecovery', async () => {
    await fs.unlink(recoveryFile()).catch(() => {})
    return true
  })

  handle('shell:openExternal', async (_e, url) => openExternalSafe(url))

  handle('file:exportText', async (_e, args) => {
    if (!args || !isString(args.content) || !isString(args.defaultName)) {
      throw new Error('Invalid export payload')
    }
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export',
      defaultPath: basename(args.defaultName),
      filters: [{ name: String(args.filterName), extensions: (args.extensions ?? []).map(String) }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    await writeFileAtomic(res.filePath, args.content)
    return { canceled: false, path: res.filePath }
  })

  handle('file:readText', async (_e, args) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import',
      properties: ['openFile'],
      filters: [{ name: String(args?.filterName), extensions: (args?.extensions ?? []).map(String) }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const content = await fs.readFile(res.filePaths[0], 'utf8')
    return { canceled: false, path: res.filePaths[0], content }
  })

  // Render an HTML report to PDF in a hidden window with scripting disabled,
  // from a private temp directory.
  handle('report:exportPdf', async (_e, args) => {
    if (!args || !isString(args.html)) throw new Error('Invalid report payload')
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export PDF Report',
      defaultPath: basename(String(args.defaultName)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }

    const dir = await fs.mkdtemp(join(tmpdir(), 'wireweaver-report-'))
    const tmpHtml = join(dir, 'report.html')
    await fs.writeFile(tmpHtml, args.html, 'utf8')
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    })
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await win.loadFile(tmpHtml)
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
      })
      await writeFileAtomic(res.filePath, pdf)
    } finally {
      win.destroy()
      void fs.rm(dir, { recursive: true, force: true })
    }
    return { canceled: false, path: res.filePath }
  })

  handle('library:choosePath', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose library database folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const dir = resolve(res.filePaths[0])
    grantedDirs.add(dir)
    return dir
  })

  handle('recent:get', async () => {
    const list = await readRecent()
    for (const e of list) grantFile(e.path)
    return list
  })

  handle('recent:add', async (_e, entry) => {
    if (!entry || !isString(entry.name)) throw new Error('Invalid recent entry')
    const path = requireGrantedFile(entry.path)
    const list = (await readRecent()).filter((e) => resolve(e.path) !== path)
    list.unshift({ name: entry.name, path, openedAt: Date.now() })
    const trimmed = list.slice(0, 10)
    await writeJsonAtomic(recentFile(), trimmed)
    return trimmed
  })

  handle('part-lookup:search', async (_e, query) => {
    const parts = await readJson<Record<string, unknown>[]>(partsFile(), [])
    const q = String(query ?? '').toLowerCase().trim()
    if (!q || !Array.isArray(parts)) return []
    const fields = ['name', 'internalPartNumber', 'manufacturer', 'manufacturerPartNumber', 'supplierPartNumber', 'notes']
    return parts
      .filter((p) => fields.some((f) => isString(p[f]) && (p[f] as string).toLowerCase().includes(q)))
      .slice(0, 20)
      .map((p) => ({
        id: String(p.id),
        kind: String(p.kind),
        name: String(p.name),
        internalPartNumber: String(p.internalPartNumber ?? ''),
        manufacturer: String(p.manufacturer ?? ''),
        manufacturerPartNumber: String(p.manufacturerPartNumber ?? ''),
        positions: typeof p.positions === 'number' ? p.positions : undefined,
        gender: isString(p.gender) ? p.gender : undefined
      }))
  })

  handle('library:listPacks', async () => {
    try {
      const dir = packsDir()
      const packs: { id: string; name: string; parts: number; templates: number }[] = []
      for (const e of await fs.readdir(dir)) {
        if (!e.toLowerCase().endsWith('.wwlib')) continue
        const data = await readJson<{ parts?: unknown[]; templates?: unknown[] }>(join(dir, e), {})
        packs.push({
          id: e,
          name: e.replace(/\.wwlib$/i, '').replace(/[-_]+/g, ' '),
          parts: Array.isArray(data.parts) ? data.parts.length : 0,
          templates: Array.isArray(data.templates) ? data.templates.length : 0
        })
      }
      return packs.sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  handle('library:readPack', async (_e, id) => {
    const safe = basename(String(id))
    if (!safe.toLowerCase().endsWith('.wwlib')) return { id: safe, data: null }
    return { id: safe, data: await readJson(join(packsDir(), safe), null) }
  })

  handle('library:getPath', async () => libraryDir())

  const requireLibraryTarget = (path: unknown): string => {
    if (path === '' || path == null) return DEFAULT_LIBRARY_DIR
    const abs = resolve(String(path))
    if (!grantedDirs.has(abs) && abs !== resolve(libraryDir())) {
      throw new Error('Choose the library folder with the folder picker.')
    }
    return abs
  }

  handle('library:setPath', async (_e, path) => {
    const target = requireLibraryTarget(path)
    await fs.mkdir(join(target, 'images'), { recursive: true })
    await saveSettings({ libraryPath: target })
    return libraryDir()
  })

  // Copy the current library into another folder and switch to it. Files
  // already at the destination are kept as timestamped backups, never
  // silently overwritten.
  handle('library:relocatePath', async (_e, path) => {
    const target = requireLibraryTarget(path)
    const old = libraryDir()
    if (resolve(old) === target) return libraryDir()
    await fs.mkdir(join(target, 'images'), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    for (const f of ['parts.json', 'pinout-templates.json']) {
      const dest = join(target, f)
      try {
        await fs.access(dest)
        await fs.rename(dest, `${dest}.backup-${stamp}`)
      } catch {
        /* nothing to back up */
      }
      try {
        await fs.copyFile(join(old, f), dest)
      } catch {
        /* source may not exist yet */
      }
    }
    try {
      for (const e of await fs.readdir(join(old, 'images'))) {
        const dest = join(target, 'images', e)
        await fs.copyFile(join(old, 'images', e), dest).catch(() => {})
      }
    } catch {
      /* no images yet */
    }
    await saveSettings({ libraryPath: target })
    return libraryDir()
  })

  handle('app:setTheme', async (_e, theme) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return
    nativeTheme.themeSource = theme
    await saveSettings({ theme })
  })

  // The renderer calls this once its listeners are up; later opens are pushed.
  handle('app:takePendingFile', async () => {
    rendererReady = true
    const file = pendingOpenFile
    pendingOpenFile = null
    return file
  })

  handle('app:closeAfterSave', async () => {
    if (projectDirty) return // the save was cancelled or failed
    allowClose = true
    mainWindow?.close()
  })
}

// ---------- Lifecycle ----------

app.on('second-instance', (_e, argv) => {
  const file = fileFromArgv(argv)
  if (file) openFromOs(file)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// macOS delivers file-association opens here, possibly before ready.
app.on('open-file', (e, path) => {
  e.preventDefault()
  openFromOs(path)
})

// Belt and braces: no webContents in this app may navigate off-app or spawn windows.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

app.whenReady().then(async () => {
  registerProtocol()
  await registerIpc()
  nativeTheme.themeSource = settings.theme ?? 'system'
  buildMenu()
  const argvFile = fileFromArgv(process.argv)
  if (argvFile) pendingOpenFile = grantFile(argvFile)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
