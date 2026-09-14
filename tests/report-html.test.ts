import { describe, it, expect } from 'vitest'
import { buildHtmlReport } from '../src/model/report-html'
import { lib, project } from './fixtures'

describe('buildHtmlReport', () => {
  it('includes the title block, BOM, harness tables, cutlist and netlist', () => {
    const html = buildHtmlReport(lib, {
      ...project,
      revision: 'A1',
      author: 'Ada',
      description: 'Bench rig'
    })
    expect(html).toContain('<title>Test Rig — WireWeaver Report</title>')
    expect(html).toContain('A1')
    expect(html).toContain('Ada')
    expect(html).toContain('Bill of Materials')
    expect(html).toContain('Harness — FC1-FC2')
    expect(html).toContain('Cutlist')
    expect(html).toContain('Netlist')
    expect(html).toContain('GND-LINK')
  })

  it('escapes HTML in user-provided strings', () => {
    const html = buildHtmlReport(lib, {
      ...project,
      name: '<script>alert(1)</script>',
      description: '<b>bold</b>'
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;')
  })

  it('embeds the diagram only for image data URLs', () => {
    const withPng = buildHtmlReport(lib, project, {
      diagramPng: 'data:image/png;base64,AAAA'
    })
    expect(withPng).toContain('<h2>Assembly</h2>')
    expect(withPng).toContain('data:image/png;base64,AAAA')

    const without = buildHtmlReport(lib, project, { diagramPng: 'not-an-image' })
    expect(without).not.toContain('<h2>Assembly</h2>')
  })

  it('documents the slack allowance when provided', () => {
    expect(buildHtmlReport(lib, project, { slackMm: 50 })).toContain('50 mm slack')
    expect(buildHtmlReport(lib, project)).not.toContain('slack per cut')
  })

  it('renders harness notes and description when present', () => {
    const p = {
      ...project,
      harnesses: [
        { ...project.harnesses[0], description: 'Main bus', notes: 'Keep short' }
      ]
    }
    const html = buildHtmlReport(lib, p)
    expect(html).toContain('Main bus')
    expect(html).toContain('Keep short')
  })
})
