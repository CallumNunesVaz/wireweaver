/**
 * End-to-end smoke test for the WireWeaver Electron app, driving the built
 * app with Playwright. Covers the flows the review found crashing or broken:
 * deleting a device, undo, new project over a populated canvas, Escape
 * layering, and opening the harness editor from the Library Manager.
 *
 * Opt-in (needs a build and a display):
 *   npm run build && npm i --no-save playwright-core
 *   WW_E2E=1 npx vitest run tests/smoke.test.ts        # (xvfb-run -a … on CI)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const isE2E = process.env['WW_E2E'] === '1' || process.env['RUN_E2E'] === '1'

const PROJECT = {
  schemaVersion: 2,
  id: 'smoke',
  name: 'Smoke Test',
  deviceInstances: [
    { id: 'i-fc', partId: 'seed-dev-fc', label: 'FC', position: { x: 0, y: 0 } },
    { id: 'i-s1', partId: 'seed-dev-sensor', label: 'Sensor 1', position: { x: 420, y: 0 } },
    { id: 'i-s2', partId: 'seed-dev-sensor', label: 'Sensor 2', position: { x: 420, y: 260 } }
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

describe.skipIf(!isE2E)('WireWeaver smoke test (E2E)', { timeout: 20_000 }, () => {
  let app: any
  let page: any
  let h: any
  let dir: string
  const errors: string[] = []

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const hasText = (t: string) => page.evaluate((s: string) => document.body.innerText.includes(s), t)
  const nodeCount = () => page.evaluate(() => document.querySelectorAll('main .react-flow__node').length)
  const crashed = () => hasText('Something went wrong')
  /** Titles of open dialogs, bottom to top. */
  const dialogs = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"]')].map((d) => {
        const id = d.getAttribute('aria-labelledby')
        return (id ? document.getElementById(id)?.textContent : d.getAttribute('aria-label')) ?? ''
      })
    )

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-smoke-'))
    const projectPath = join(dir, 'smoke.wwv')
    writeFileSync(projectPath, JSON.stringify(PROJECT))
    process.env['WW_CONFIG_DIR'] = join(dir, 'config')
    process.env['SCREENSHOT_DIR'] = join(dir, 'shots')
    const driver = await import('../../.claude/skills/run-desktop/driver.mjs')
    const res = await driver.launch({ recent: [{ name: 'Smoke Test', path: projectPath }] })
    app = res.app
    page = res.page
    h = driver.helpers(page, app)
    page.on('pageerror', (e: Error) => errors.push(e.message))
    await h.clickTitle('Project actions')
    await sleep(300)
    await h.clickText('Recent: Smoke Test')
    await sleep(1500)
  }, 60_000)

  afterAll(async () => {
    if (app) {
      const { closeApp } = await import('../../.claude/skills/run-desktop/driver.mjs')
      await closeApp(app, page)
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('opens a project from Recent', async () => {
    expect(await page.$('[data-testid="library-sidebar"]')).toBeTruthy()
    expect(await nodeCount()).toBe(3)
  })

  it('deletes a device from the context menu without crashing, and undo restores it', async () => {
    await page.click('main .react-flow__node[data-id="i-s2"]', { button: 'right' })
    await sleep(300)
    await h.clickText('Delete device')
    await sleep(500)
    expect(await crashed()).toBe(false)
    expect(await nodeCount()).toBe(2)
    await page.click('main .react-flow__pane', { position: { x: 20, y: 400 } })
    await page.keyboard.press('ControlOrMeta+z')
    await sleep(500)
    expect(await nodeCount()).toBe(3)
  })

  it('keeps Ctrl+Z inside a text field as text undo', async () => {
    await page.click('main .react-flow__node[data-id="i-s1"]')
    await sleep(300)
    const input = page.locator('aside[aria-label="Inspector"] input').first()
    await input.click()
    await page.keyboard.press('End')
    await page.keyboard.type('X')
    await page.keyboard.press('ControlOrMeta+z')
    await sleep(300)
    expect(await nodeCount()).toBe(3)
  })

  it('opens the ? cheatsheet and closes it with Escape', async () => {
    await page.click('main .react-flow__pane', { position: { x: 20, y: 400 } })
    await page.keyboard.press('?')
    await sleep(300)
    expect(await hasText('Keyboard Shortcuts')).toBe(true)
    await page.keyboard.press('Escape')
    await sleep(300)
    expect(await hasText('Keyboard Shortcuts')).toBe(false)
  })

  it('Escape closes only the top-most of two stacked modals', async () => {
    await page.locator('[data-testid="library-sidebar"] >> text=Flight Controller').first().dblclick()
    await sleep(500)
    await h.clickText('New pinout template')
    await sleep(400)
    expect(await dialogs()).toEqual(['Edit device', 'New pinout template'])
    await page.keyboard.press('Escape')
    await sleep(300)
    expect(await dialogs()).toEqual(['Edit device'])
    await page.keyboard.press('Escape')
    await sleep(300)
    expect(await dialogs()).toEqual([])
  })

  it('opens the harness editor on top of the Library Manager', async () => {
    // Open via the Tools menu: this test is about overlay stacking. (On macOS
    // the keyboard path is the native menu accelerator, which CDP-dispatched
    // keys don't reach; the shortcut itself is covered in dialogs.test.ts.)
    await h.clickTitle('Tools & exports')
    await sleep(300)
    await h.clickText('Library Manager')
    await sleep(600)
    // The manager's list is virtualised; on a small screen (macOS CI) the
    // harness section can be below the rendered rows, so search for it.
    await page.locator('[aria-label="Library Manager"] input[aria-label="Search the library"]').fill('CAN Bus')
    await sleep(300)
    await page.locator('[aria-label="Library Manager"] >> text=CAN Bus').first().click()
    await sleep(300)
    await h.clickText('Open harness editor')
    await sleep(800)
    const top = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      return el?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? null
    })
    expect(top).toMatch(/^Harness editor/)
    await page.keyboard.press('Escape') // closes the editor…
    await sleep(300)
    expect(await dialogs()).toEqual(['Library Manager']) // …not the manager
    await page.keyboard.press('Escape')
    await sleep(300)
    expect(await dialogs()).toEqual([])
  })

  it('starts a new project over a populated canvas without crashing', async () => {
    await page.keyboard.press('ControlOrMeta+n')
    await sleep(400)
    if (await hasText('Unsaved changes')) {
      await h.clickText("Don't save")
      await sleep(600)
    }
    expect(await crashed()).toBe(false)
    expect(await nodeCount()).toBe(0)
  })

  it('recorded no uncaught page errors', () => {
    expect(errors).toEqual([])
  })
})
