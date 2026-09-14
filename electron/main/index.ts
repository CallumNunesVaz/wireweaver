import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron'
import { join, extname, relative, isAbsolute, basename } from 'node:path'
import { promises as fs, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'

const isDev = !app.isPackaged

// Stable app name so userData resolves to a WireWeaver folder even when run unpackaged.
app.setName('WireWeaver')

// The ww:// scheme serves the packaged renderer (ww://app/…) and library images
// (ww://image/…). A real registered scheme gives the app a proper origin, which
// lets a strict CSP with `script-src 'self'` work (file:// origins can't match
// 'self') and lets Chromium cache images instead of round-tripping base64 IPC.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ww',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// ---------- Storage paths ----------

const DEFAULT_LIBRARY_DIR = join(app.getPath('userData'), 'library')

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

interface AppSettings {
  libraryPath?: string
}

let _settings: AppSettings | undefined
let _cachedLibDir: string | undefined

function libraryDir(): string {
  return _cachedLibDir ?? DEFAULT_LIBRARY_DIR
}

/** Directory holding bundled starter packs (repo data/ in dev, resources in prod). */
function packsDir(): string {
  return isDev
    ? join(app.getAppPath(), 'data')
    : join(process.resourcesPath, 'data')
}

async function initSettings(): Promise<void> {
  _settings = await readJson<AppSettings>(settingsFile(), {})
  _cachedLibDir = _settings.libraryPath ?? DEFAULT_LIBRARY_DIR
}

async function persistLibraryPath(path: string): Promise<void> {
  const settings = { ...(_settings ?? {}), libraryPath: path }
  await writeJsonAtomic(settingsFile(), settings)
  _settings = settings
  _cachedLibDir = path
}

function imagesDir(): string {
  return join(libraryDir(), 'images')
}
function partsFile(): string {
  return join(libraryDir(), 'parts.json')
}
function templatesFile(): string {
  return join(libraryDir(), 'pinout-templates.json')
}
function recentFile(): string {
  return join(libraryDir(), 'recent-projects.json')
}
function recoveryFile(): string {
  return join(app.getPath('userData'), 'recovery.wwv')
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(imagesDir(), { recursive: true })
}

// ---------- Atomic JSON write ----------
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  try {
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

interface RecentEntry {
  name: string
  path: string
  openedAt: number
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

async function fileResponse(file: string): Promise<Response> {
  const buf = await fs.readFile(file)
  const ext = extname(file).slice(1).toLowerCase()
  return new Response(buf, {
    headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' }
  })
}

const IMAGE_NAME = /^[a-f0-9]{64}\.[a-z0-9]+$/i

function thumbName(imageName: string): string {
  return imageName.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
}

function registerProtocol(): void {
  const rendererDir = join(__dirname, '../renderer')

  protocol.handle('ww', async (request) => {
    try {
      const url = new URL(request.url)

      // ww://image/<variant>/<name>  where variant is 'full' or 'thumb'
      if (url.host === 'image') {
        const [, variant, name] = url.pathname.split('/')
        if (!name || !IMAGE_NAME.test(name)) {
          return new Response('Bad request', { status: 400 })
        }
        if (variant === 'thumb') {
          try {
            return await fileResponse(join(imagesDir(), thumbName(name)))
          } catch {
            // No thumbnail (older import) — fall through to the original.
          }
        }
        return await fileResponse(join(imagesDir(), name))
      }

      // ww://app/…  — the built renderer
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#14161b',
    show: false,
    autoHideMenuBar: true,
    title: 'WireWeaver',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (e) => {
    if (projectDirty) {
      e.preventDefault()
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Discard them?',
        detail: 'If you close now, unsaved changes will be lost.',
        buttons: ['Discard', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (choice === 1) return
      projectDirty = false
      // The user chose to discard, so don't offer this work back on next launch.
      rmSync(recoveryFile(), { force: true })
      mainWindow!.close()
    }
  })

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('ww://app/')
  }
}

// ---------- IPC ----------
async function registerIpc(): Promise<void> {
  await initSettings()

  ipcMain.handle('library:load', async () => {
    await ensureDirs()
    let isNew = false
    try {
      await fs.access(partsFile())
    } catch {
      isNew = true
    }
    const parts = await readJson(partsFile(), [])
    const templates = await readJson(templatesFile(), [])
    return { parts, templates, isNew }
  })

  ipcMain.handle('library:saveParts', async (_e, parts: unknown) => {
    await ensureDirs()
    await writeJsonAtomic(partsFile(), parts)
    return true
  })

  ipcMain.handle('library:saveTemplates', async (_e, templates: unknown) => {
    await ensureDirs()
    await writeJsonAtomic(templatesFile(), templates)
    return true
  })

  ipcMain.handle('library:export', async (_e, data: { parts: unknown; templates: unknown }) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Library',
      defaultPath: 'wireweaver-library.wwlib',
      filters: [{ name: 'WireWeaver Library', extensions: ['wwlib'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    await writeJsonAtomic(res.filePath, data)
    return { canceled: false, path: res.filePath }
  })

  ipcMain.handle('library:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Library',
      properties: ['openFile'],
      filters: [{ name: 'WireWeaver Library', extensions: ['wwlib'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const data = await readJson(res.filePaths[0], null)
    return { canceled: false, path: res.filePaths[0], data }
  })

  // Store an image (and optional pre-rendered thumbnail) by content hash.
  ipcMain.handle(
    'image:import',
    async (_e, payload: { dataUrl: string; thumbDataUrl?: string }) => {
      await ensureDirs()
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(payload.dataUrl)
      if (!match) throw new Error('Unsupported image data')
      const mime = match[1]
      const buf = Buffer.from(match[2], 'base64')
      const hash = createHash('sha256').update(buf).digest('hex')
      const ext = mime.split('/')[1].replace('+xml', '').replace('jpeg', 'jpg')
      const filename = `${hash}.${ext}`
      const dest = join(imagesDir(), filename)
      try {
        await fs.access(dest)
      } catch {
        await fs.writeFile(dest, buf)
      }
      if (payload.thumbDataUrl) {
        const tmatch = /^data:image\/webp;base64,(.+)$/.exec(payload.thumbDataUrl)
        if (tmatch) {
          await fs.writeFile(
            join(imagesDir(), thumbName(filename)),
            Buffer.from(tmatch[1], 'base64')
          )
        }
      }
      return { hash: filename }
    }
  )

  ipcMain.handle('project:save', async (_e, args: { path?: string; data: unknown }) => {
    let target = args.path
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save WireWeaver Project',
        defaultPath: 'project.wwv',
        filters: [{ name: 'WireWeaver Project', extensions: ['wwv'] }]
      })
      if (res.canceled || !res.filePath) return { canceled: true }
      target = res.filePath
    }
    await writeJsonAtomic(target, args.data)
    return { canceled: false, path: target }
  })

  ipcMain.handle('project:open', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open WireWeaver Project',
      properties: ['openFile'],
      filters: [{ name: 'WireWeaver Project', extensions: ['wwv'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const path = res.filePaths[0]
    const data = await readJson(path, null)
    return { canceled: false, path, data }
  })

  ipcMain.handle('project:openPath', async (_e, path: string) => {
    const data = await readJson(path, null)
    if (!data) return { canceled: true }
    return { canceled: false, path, data }
  })

  ipcMain.handle('project:setDirty', async (_e, dirty: boolean) => {
    projectDirty = dirty
  })

  // Crash recovery: a rolling autosave outside the library so unsaved work
  // survives a hard quit. Cleared on explicit save / new / open.
  ipcMain.handle(
    'project:autosave',
    async (_e, args: { data: unknown; path?: string }) => {
      await writeJsonAtomic(recoveryFile(), {
        savedAt: Date.now(),
        data: args.data,
        path: args.path
      })
      return true
    }
  )

  ipcMain.handle('project:getRecovery', async () => {
    const rec = await readJson<{ savedAt: number; data: unknown; path?: string } | null>(
      recoveryFile(),
      null
    )
    if (!rec || !rec.data) return { exists: false }
    return { exists: true, savedAt: rec.savedAt, data: rec.data, path: rec.path }
  })

  ipcMain.handle('project:clearRecovery', async () => {
    await fs.unlink(recoveryFile()).catch(() => {})
    return true
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('http')) await shell.openExternal(url)
    return true
  })

  ipcMain.handle('bom:export', async (_e, csv: string, defaultName: string) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export BOM',
      defaultPath: defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    const tmp = `${res.filePath}.${process.pid}.tmp`
    await fs.writeFile(tmp, csv, 'utf8')
    await fs.rename(tmp, res.filePath)
    return { canceled: false, path: res.filePath }
  })

  // Generic "save text to a user-chosen file" used by report/CSV/YAML exports.
  ipcMain.handle(
    'file:exportText',
    async (
      _e,
      args: { content: string; defaultName: string; filterName: string; extensions: string[] }
    ) => {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export',
        defaultPath: args.defaultName,
        filters: [{ name: args.filterName, extensions: args.extensions }]
      })
      if (res.canceled || !res.filePath) return { canceled: true }
      const tmp = `${res.filePath}.${process.pid}.tmp`
      await fs.writeFile(tmp, args.content, 'utf8')
      await fs.rename(tmp, res.filePath)
      return { canceled: false, path: res.filePath }
    }
  )

  // Read a text file chosen by the user (WireViz import, etc.).
  ipcMain.handle(
    'file:readText',
    async (_e, args: { filterName: string; extensions: string[] }) => {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import',
        properties: ['openFile'],
        filters: [{ name: args.filterName, extensions: args.extensions }]
      })
      if (res.canceled || res.filePaths.length === 0) return { canceled: true }
      const content = await fs.readFile(res.filePaths[0], 'utf8')
      return { canceled: false, path: res.filePaths[0], content }
    }
  )

  // Render an HTML report to PDF via a hidden window.
  ipcMain.handle(
    'report:exportPdf',
    async (_e, args: { html: string; defaultName: string }) => {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export PDF Report',
        defaultPath: args.defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { canceled: true }

      const tmpHtml = join(app.getPath('temp'), `wireweaver-report-${process.pid}.html`)
      await fs.writeFile(tmpHtml, args.html, 'utf8')
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      try {
        await win.loadFile(tmpHtml)
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
        })
        await fs.writeFile(res.filePath, pdf)
      } finally {
        win.destroy()
        fs.unlink(tmpHtml).catch(() => {})
      }
      return { canceled: false, path: res.filePath }
    }
  )

  ipcMain.handle('library:choosePath', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose library database folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle('recent:get', async () => {
    return readJson<RecentEntry[]>(recentFile(), [])
  })

  ipcMain.handle('part-lookup:search', async (_e, query: string) => {
    const parts: unknown[] = await readJson(partsFile(), [])
    const q = query.toLowerCase().trim()
    if (!q) return []
    const results = (parts as any[]).filter((p: any) => {
      const fields = [
        p.name,
        p.internalPartNumber,
        p.manufacturer,
        p.manufacturerPartNumber,
        p.supplierPartNumber,
        p.notes
      ]
      return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))
    })
    return results.slice(0, 20).map((p: any) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      internalPartNumber: p.internalPartNumber,
      manufacturer: p.manufacturer,
      manufacturerPartNumber: p.manufacturerPartNumber,
      positions: p.positions,
      gender: p.gender
    }))
  })

  ipcMain.handle('recent:add', async (_e, entry: { name: string; path: string }) => {
    await ensureDirs()
    const list = await readJson<RecentEntry[]>(recentFile(), [])
    const filtered = list.filter((e) => e.path !== entry.path)
    filtered.unshift({ ...entry, openedAt: Date.now() })
    const trimmed = filtered.slice(0, 10)
    await writeJsonAtomic(recentFile(), trimmed)
    return trimmed
  })

  // Bundled starter content packs (data/*.wwlib) shipped beside the app.
  ipcMain.handle('library:listPacks', async () => {
    try {
      const dir = packsDir()
      const entries = await fs.readdir(dir)
      const packs: { id: string; name: string; parts: number; templates: number }[] = []
      for (const e of entries) {
        if (!e.toLowerCase().endsWith('.wwlib')) continue
        const data = await readJson<{ parts?: unknown[]; templates?: unknown[] }>(
          join(dir, e),
          {}
        )
        packs.push({
          id: e,
          name: e.replace(/\.wwlib$/i, '').replace(/[-_]+/g, ' '),
          parts: Array.isArray(data.parts) ? data.parts.length : 0,
          templates: Array.isArray(data.templates) ? data.templates.length : 0
        })
      }
      packs.sort((a, b) => a.name.localeCompare(b.name))
      return packs
    } catch {
      return []
    }
  })

  ipcMain.handle('library:readPack', async (_e, id: string) => {
    const safe = basename(String(id))
    if (!safe.toLowerCase().endsWith('.wwlib')) return { id: safe, data: null }
    const data = await readJson(join(packsDir(), safe), null)
    return { id: safe, data }
  })

  ipcMain.handle('library:getPath', async () => {
    return libraryDir()
  })

  ipcMain.handle('library:setPath', async (_e, path: string) => {
    const target = path || DEFAULT_LIBRARY_DIR
    await ensureDirsForPath(target)
    await persistLibraryPath(target)
    return libraryDir()
  })

  ipcMain.handle('library:relocatePath', async (_e, path: string) => {
    const target = path || DEFAULT_LIBRARY_DIR
    const old = libraryDir()
    if (old === target) return libraryDir()
    await ensureDirsForPath(target)
    const files = ['parts.json', 'pinout-templates.json', 'recent-projects.json']
    for (const f of files) {
      try {
        const data = await fs.readFile(join(old, f))
        await fs.writeFile(join(target, f), data)
      } catch { /* file may not exist yet */ }
    }
    try {
      const imagesSrc = join(old, 'images')
      const imagesDst = join(target, 'images')
      await fs.mkdir(imagesDst, { recursive: true })
      const entries = await fs.readdir(imagesSrc)
      for (const e of entries) {
        await fs.copyFile(join(imagesSrc, e), join(imagesDst, e))
      }
    } catch { /* no images yet */ }
    await persistLibraryPath(target)
    return libraryDir()
  })
}

async function ensureDirsForPath(path: string): Promise<void> {
  await fs.mkdir(join(path, 'images'), { recursive: true })
}

app.whenReady().then(async () => {
  registerProtocol()
  await registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
