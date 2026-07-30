/**
 * Smoke test for the WireWeaver Electron app.
 *
 * This test requires the app to be built and running in a Playwright-driven
 * Electron environment. It is skipped by default and intended for E2E CI.
 *
 * Usage:
 *   1. Build the app:   npm run build
 *   2. Install Playwright: npx playwright install
 *   3. Run:   npx vitest run tests/smoke.test.ts
 *
 * You can also import helpers manually:
 *   import { launch, helpers, closeApp } from '../.claude/skills/run-desktop/driver.mjs'
 *
 * The test flow:
 *   1. Launch app → see starter library
 *   2. Create a device from the library
 *   3. Drop second device on canvas
 *   4. Create a harness between them
 *   5. Verify harness appears
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const isE2E = process.env['WW_E2E'] === '1' || process.env['RUN_E2E'] === '1'

describe('WireWeaver smoke test (E2E)', () => {
  let app: any
  let page: any
  let h: any

  beforeAll(async () => {
    if (!isE2E) return
    const { launch, helpers: buildHelpers } = await import(
      '../.claude/skills/run-desktop/driver.mjs'
    )
    const result = await launch()
    app = result.app
    page = result.page
    h = buildHelpers(page)
  })

  afterAll(async () => {
    if (!isE2E || !app) return
    const { closeApp } = await import('../.claude/skills/run-desktop/driver.mjs')
    await closeApp(app, page)
  })

  it('app launches with library sidebar visible', async () => {
    if (!isE2E) return
    const sidebar = await page.$('[data-testid="library-sidebar"]')
    expect(sidebar).toBeTruthy()
  })

  it('can add a device to the canvas', async () => {
    if (!isE2E) return
    // Drag Flight Controller from library to canvas
    const fc = await page.$('text=Flight Controller')
    expect(fc).toBeTruthy()
    await fc.click()
    await page.mouse.click(400, 300)
    await page.waitForTimeout(500)

    const nodes = await page.$$('.react-flow__node')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('can create a harness between two devices', async () => {
    if (!isE2E) return
    // Add second device
    await page.mouse.click(600, 300)
    await page.waitForTimeout(500)

    // Drag from first port handle to second
    const handles = await page.$$('.react-flow__handle')
    if (handles.length >= 2) {
      await h.drag(
        '.react-flow__handle.source',
        '.react-flow__handle.target'
      )
      await page.waitForTimeout(500)
    }

    const edges = await page.$$('.react-flow__edge')
    expect(edges.length).toBeGreaterThan(0)
  })

  it('takes a screenshot of the final canvas', async () => {
    if (!isE2E) return
    await h.ss('smoke-final')
  })
})
