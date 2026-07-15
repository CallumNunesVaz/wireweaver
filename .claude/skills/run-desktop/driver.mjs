// Playwright driver for the WireWeaver Electron app.
//
// Two ways to use it:
//   1. Import the helpers into a scripted flow (recommended on this machine —
//      tmux is not installed):
//        import { launch, helpers } from './driver.mjs'
//        const { page, app } = await launch({ recent: [{ name, path }] })
//        const h = helpers(page)
//        await h.clickTitle('Reports & exports')
//   2. Run directly for a stdin REPL: node driver.mjs
//        commands: launch | ss [name] | click <sel> | click-text <t> |
//                  click-title <t> | drag <fromSel> <toSel> | type <text> |
//                  press <key> | eval <js> | text [sel] | quit
//
// See SKILL.md in this directory for the gotchas — read it first.
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(path.join(APP_DIR, 'package.json'))
const { _electron: electron } = require('playwright-core')

const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/ww-shots'
const CONFIG_DIR = process.env.WW_CONFIG_DIR || '/tmp/ww-uitest-config'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Launch the app with an isolated userData dir (never touches the real
 * library). options.recent pre-seeds the Recent-projects menu — the only
 * dialog-free way to open a .wwv project file.
 */
export async function launch(options = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const libDir = path.join(CONFIG_DIR, 'WireWeaver', 'library')
  fs.mkdirSync(libDir, { recursive: true })
  if (options.recent) {
    fs.writeFileSync(
      path.join(libDir, 'recent-projects.json'),
      JSON.stringify(options.recent.map((r) => ({ ...r, openedAt: Date.now() })))
    )
  }
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', path.join(APP_DIR, 'out/main/index.js')],
    cwd: APP_DIR,
    env: { ...process.env, XDG_CONFIG_HOME: CONFIG_DIR, DISPLAY: process.env.DISPLAY || ':1' },
    timeout: 30000
  })
  const page = await app.firstWindow()
  await page.waitForSelector('header', { timeout: 15000 })
  await sleep(1200)
  return { app, page }
}

/**
 * ALWAYS close through this. A dirty project triggers a native "Unsaved
 * changes" dialog on close — unscriptable, and it hangs the app on the user's
 * screen until a human dismisses it. Clearing the dirty flag over IPC first
 * (the renderer API is on window.ww) means close never asks.
 */
export async function closeApp(app, page) {
  await page.evaluate(() => window.ww.project.setDirty(false)).catch(() => {})
  await app.close().catch(() => {})
}

/** Interaction helpers bound to a page. All log what they did. */
export function helpers(page) {
  let shot = 0

  const ss = async (name) => {
    shot += 1
    const f = path.join(SHOT_DIR, `${String(shot).padStart(2, '0')}-${name || 'shot'}.png`)
    await page.screenshot({ path: f })
    console.log('SHOT', f)
    return f
  }

  // DOM click — coordinate-free, works under overlays.
  const click = async (sel) =>
    console.log('click', sel, '→', await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel))

  const clickTitle = async (t) =>
    console.log('click-title', t, '→', await page.evaluate((s) => {
      const el = document.querySelector(`[title="${s}"]`)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, t))

  const clickText = async (t) =>
    console.log('click-text', t, '→', await page.evaluate((s) => {
      const els = [...document.querySelectorAll('button')]
      const el = els.find((e) => e.textContent?.trim() === s) ??
                 els.find((e) => e.textContent?.includes(s))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, t))

  // Element center + occlusion check. Ports intentionally stack an invisible
  // target handle behind the visible source handle, so any handle at the
  // point counts as "on target" for handle selectors.
  const probe = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return { err: 'NO_ELEMENT' }
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      const hit = document.elementFromPoint(x, y)
      const onTarget =
        el === hit || el.contains(hit) ||
        (s.includes('react-flow__handle') && !!hit?.closest?.('.react-flow__handle'))
      return { x, y, onTarget, hitDesc: hit?.className?.toString?.().slice(0, 60) }
    }, sel)

  const center = async (sel) => {
    for (let i = 0; i < 6; i++) {
      const p = await probe(sel)
      if (p.err) { console.log('NO_ELEMENT:', sel); return null }
      if (p.onTarget) return p
      console.log(`occluded (${sel}) by:`, p.hitDesc, '— retrying')
      await sleep(400)
    }
    console.log('GIVING UP (occluded):', sel)
    return null
  }

  // Real mouse drag — the only way to trigger React Flow connection gestures
  // (port→port in the assembly view, pin→pin in the harness editor).
  const drag = async (fromSel, toSel) => {
    const a = await center(fromSel)
    const b = await center(toSel)
    if (!a || !b) return console.log('DRAG SKIPPED', fromSel, '→', toSel)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 10 })
    await page.mouse.move(b.x, b.y, { steps: 10 })
    await sleep(150)
    await page.mouse.up()
    console.log('drag OK', fromSel, '→', toSel)
  }

  // A screen point that is actually ON an SVG path (edges are curves — the
  // bounding-box center usually misses them).
  const pathPoint = (sel, frac = 0.5) =>
    page.evaluate(({ s, f }) => {
      const p = document.querySelector(s)
      if (!p) return null
      const pt = p.getPointAtLength(p.getTotalLength() * f)
      const m = p.getScreenCTM()
      return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }
    }, { s: sel, f: frac })

  const edgeIds = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__edge')].map((e) => e.getAttribute('data-id'))
    )

  const text = async (sel) =>
    page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)

  return { ss, click, clickTitle, clickText, probe, center, drag, pathPoint, edgeIds, text }
}

// ---------- REPL mode ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let app = null
  let page = null
  let h = null
  const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
  const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })
  const COMMANDS = {
    async launch() {
      if (app) return console.log('already launched')
      ;({ app, page } = await launch())
      h = helpers(page)
      console.log('launched')
    },
    async ss(a) { await h?.ss(a) },
    async click(a) { await h?.click(a) },
    async 'click-text'(a) { await h?.clickText(a) },
    async 'click-title'(a) { await h?.clickTitle(a) },
    async drag(a) { const [f, t] = a.split(/\s+/); await h?.drag(f, t) },
    async type(a) { await page?.keyboard.type(a, { delay: 30 }) },
    async press(a) { await page?.keyboard.press(a) },
    async eval(a) { console.log(JSON.stringify(await page?.evaluate(a))) },
    async text(a) { console.log(await h?.text(a)) },
    async quit() { if (app) await closeApp(app, page); process.exit(0) },
    help() { console.log('commands:', Object.keys(COMMANDS).join(', ')) }
  }
  rl.on('line', async (line) => {
    const i = line.indexOf(' ')
    const cmd = i < 0 ? line.trim() : line.slice(0, i)
    const rest = i < 0 ? '' : line.slice(i + 1).trim()
    const fn = COMMANDS[cmd]
    if (cmd) {
      if (!fn) console.log('unknown:', cmd, '— try: help')
      else { try { await fn(rest) } catch (e) { console.log('ERROR:', e.message) } }
    }
    rl.prompt()
  })
  console.log('WireWeaver driver — "help" for commands, "launch" to start')
  rl.prompt()
}
