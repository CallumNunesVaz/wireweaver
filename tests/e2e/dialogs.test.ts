/**
 * End-to-end tests for the native-dialog seam and starter-pack installation.
 * Drives the built app with Playwright and the test-only dialog queue
 * (electron/main/testDialogs.ts), so Save/Open/export flows that a native
 * dialog would normally block can be exercised end to end.
 *
 * Opt-in (needs a build and a display):
 *   npm run build
 *   npm run test:e2e          # sets WW_E2E=1, runs tests/e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const isE2E = process.env['WW_E2E'] === '1' || process.env['RUN_E2E'] === '1'

const REPO_ROOT = process.cwd()

/** A fixture project referencing the seed library, with one harness + wire. */
const FIXTURE = {
  schemaVersion: 2,
  id: 'fixture',
  name: 'Fixture Project',
  deviceInstances: [
    { id: 'i-fc', partId: 'seed-dev-fc', label: 'FC', position: { x: 0, y: 0 } },
    { id: 'i-s1', partId: 'seed-dev-sensor', label: 'Sensor 1', position: { x: 420, y: 0 } }
  ],
  harnesses: [
    {
      id: 'h1',
      name: 'CAN Bus',
      endpoints: [
        { deviceInstanceId: 'i-fc', portId: 'p-can-a' },
        { deviceInstanceId: 'i-s1', portId: 'p-can' }
      ],
      wires: [{ id: 'w1', from: { end: 'a', position: 2 }, to: { end: 'b', position: 2 } }],
      segments: [],
      accessories: [],
      splices: []
    }
  ],
  partSnapshots: {},
  templateSnapshots: {},
  revisions: []
}

describe.skipIf(!isE2E)('WireWeaver dialog seam (E2E)', { timeout: 30_000 }, () => {
  let app: any
  let page: any
  let h: any
  let queueDialog: any
  let dir: string
  const errors: string[] = []

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const waitFor = async (fn: () => boolean, timeout = 5000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (fn()) return true
      await sleep(100)
    }
    return fn()
  }

  const nodeCount = () =>
    page.evaluate(() => document.querySelectorAll('main .react-flow__node').length)

  const dirtyDot = () =>
    page.evaluate(() => !!document.querySelector('[aria-label="unsaved changes"]'))

  const titleName = () =>
    page.evaluate(
      () => document.querySelector('[title="Rename project"] span')?.textContent?.trim() ?? ''
    )

  const toastText = () =>
    page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? '')

  /** "5 parts · 1 templates" span next to the Library Manager heading. */
  const libCount = () =>
    page.evaluate(() => {
      const h2 = [...document.querySelectorAll('[aria-label="Library Manager"] h2')].find(
        (x) => x.textContent === 'Library Manager'
      )
      return h2?.nextElementSibling?.textContent?.trim() ?? ''
    })

  async function renameProject(name: string): Promise<void> {
    await h.clickTitle('Rename project')
    await sleep(200)
    await page.fill('[aria-label="Project name"]', name)
    await page.keyboard.press('Enter')
    await sleep(300)
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-dialogs-'))
    const packsDir = join(dir, 'packs')
    mkdirSync(packsDir, { recursive: true })
    cpSync(join(REPO_ROOT, 'tests/fixtures/packs/smoke.wwlib'), join(packsDir, 'smoke.wwlib'))
    writeFileSync(join(dir, 'fixture.wwv'), JSON.stringify(FIXTURE))

    process.env['WW_CONFIG_DIR'] = join(dir, 'config')
    process.env['WW_PACKS_DIR'] = packsDir

    const driver = await import('../../.claude/skills/run-desktop/driver.mjs')
    queueDialog = driver.queueDialog
    const res = await driver.launch()
    app = res.app
    page = res.page
    h = driver.helpers(page, app)
    page.on('pageerror', (e: Error) => errors.push(e.message))
    await page.waitForSelector('[data-testid="library-sidebar"]', { timeout: 15_000 })
    await sleep(800)
  }, 60_000)

  afterAll(async () => {
    if (app) {
      const { closeApp } = await import('../../.claude/skills/run-desktop/driver.mjs')
      await closeApp(app, page)
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
    delete process.env['WW_PACKS_DIR']
  })

  it('Save As writes a file, clears the unsaved dot, then Ctrl+S re-saves silently', async () => {
    const savePath = join(dir, 'saved.wwv')

    await renameProject('My Test Project')
    expect(await dirtyDot()).toBe(true)

    await queueDialog(app, { filePaths: [savePath] })
    await page.keyboard.press('Control+Shift+S')
    expect(await waitFor(() => existsSync(savePath))).toBe(true)

    const written = JSON.parse(readFileSync(savePath, 'utf8'))
    expect(written.schemaVersion).toBe(2)
    expect(written.name).toBe('My Test Project')
    expect(await titleName()).toBe('My Test Project')
    expect(await dirtyDot()).toBe(false)

    await renameProject('My Test Project 2')
    expect(await dirtyDot()).toBe(true)
    await page.keyboard.press('Control+s')
    await sleep(600)

    const rewritten = JSON.parse(readFileSync(savePath, 'utf8'))
    expect(rewritten.name).toBe('My Test Project 2')
    expect(await dirtyDot()).toBe(false)
  })

  it('opens a fixture project from the Project menu', async () => {
    await queueDialog(app, { filePaths: [join(dir, 'fixture.wwv')] })
    await h.clickTitle('Project actions')
    await sleep(300)
    await h.clickText('Open project…')
    await sleep(1500)
    expect(await nodeCount()).toBe(2)
  })

  it('rejects opening a path the user did not pick', async () => {
    const rejected = await page.evaluate(async () => {
      try {
        await window.ww.project.openPath('/etc/hosts')
        return false
      } catch {
        return true
      }
    })
    expect(rejected).toBe(true)
  })

  it('leaves the project dirty when Save As is cancelled', async () => {
    const before = readdirSync(dir)
      .filter((f) => f.endsWith('.wwv'))
      .sort()

    await renameProject('Fixture Project X')
    expect(await dirtyDot()).toBe(true)

    await queueDialog(app, { canceled: true })
    await page.keyboard.press('Control+Shift+S')
    await sleep(600)

    expect(await dirtyDot()).toBe(true)
    const after = readdirSync(dir)
      .filter((f) => f.endsWith('.wwv'))
      .sort()
    expect(after).toEqual(before)
  })

  it('exports wiring CSV and PDF reports to files', async () => {
    const csvPath = join(dir, 'wiring.csv')
    const pdfPath = join(dir, 'report.pdf')

    await page.keyboard.press('Control+r')
    await sleep(800)

    await queueDialog(app, { filePaths: [csvPath] })
    await h.clickText('Wiring CSV')
    expect(await waitFor(() => existsSync(csvPath))).toBe(true)
    expect(readFileSync(csvPath, 'utf8').length).toBeGreaterThan(0)

    await queueDialog(app, { filePaths: [pdfPath] })
    await h.clickText('PDF Report')
    expect(await waitFor(() => existsSync(pdfPath), 15_000)).toBe(true)
    expect(readFileSync(pdfPath).subarray(0, 4).toString()).toBe('%PDF')

    await page.keyboard.press('Escape')
    await sleep(300)
  })

  it('lists and installs the fixture starter pack, then reports nothing new', async () => {
    await page.keyboard.press('Control+l')
    await sleep(800)

    await h.clickText('Starter packs')
    await sleep(500)
    const packs = await page.evaluate(() =>
      document.body.innerText.includes('3 parts · 1 templates')
    )
    expect(packs).toBe(true)

    expect(await libCount()).toBe('5 parts · 1 templates')

    await h.clickText('Install')
    await sleep(600)
    expect(await libCount()).toBe('8 parts · 2 templates')

    await h.clickText('Install')
    await sleep(600)
    expect(await libCount()).toBe('8 parts · 2 templates')
    expect(await toastText()).toContain('nothing new')
  })

  it('copies the library to a new folder and keeps working', async () => {
    const newLibDir = join(dir, 'library-copy')

    await queueDialog(app, { filePaths: [newLibDir] })
    await h.clickText('Folder…')
    await sleep(500)
    await h.clickText('Copy my library')
    await sleep(1500)

    expect(existsSync(join(newLibDir, 'parts'))).toBe(true)
    expect(readdirSync(join(newLibDir, 'parts')).length).toBeGreaterThan(0)
    expect(existsSync(join(newLibDir, 'templates'))).toBe(true)
    expect(readdirSync(join(newLibDir, 'templates')).length).toBeGreaterThan(0)
    expect(await libCount()).toBe('8 parts · 2 templates')
  })

  it('recorded no uncaught page errors', () => {
    expect(errors).toEqual([])
  })
})
