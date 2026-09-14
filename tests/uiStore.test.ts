import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../src/stores/uiStore'

function reset(): void {
  useUiStore.setState({
    librarySearch: '',
    libraryCollapsed: false,
    selection: null,
    multiSelectedIds: [],
    hoverHarnessId: null,
    hoverEndpoints: [],
    partEditor: null,
    templateEditorId: undefined,
    harnessEditorId: null,
    libraryManagerOpen: false,
    reportsOpen: false,
    drcOpen: false,
    drcIndex: 0,
    revisionsOpen: false,
    commandPaletteOpen: false,
    cheatsheetOpen: false,
    calculatorOpen: false,
    docsOpen: false,
    showReconciliation: false,
    reconciliationItems: { parts: [], templates: [] }
  })
}

describe('uiStore', () => {
  beforeEach(reset)

  it('select clears the multi-selection', () => {
    useUiStore.getState().toggleMultiSelect('a')
    useUiStore.getState().select({ type: 'instance', id: 'x' })
    expect(useUiStore.getState().multiSelectedIds).toEqual([])
    expect(useUiStore.getState().selection).toEqual({ type: 'instance', id: 'x' })
  })

  it('toggles multi-select membership', () => {
    useUiStore.getState().toggleMultiSelect('a')
    useUiStore.getState().toggleMultiSelect('b')
    useUiStore.getState().toggleMultiSelect('a')
    expect(useUiStore.getState().multiSelectedIds).toEqual(['b'])
    useUiStore.getState().clearMultiSelect()
    expect(useUiStore.getState().multiSelectedIds).toEqual([])
  })

  it('toggles every overlay', () => {
    const s = useUiStore.getState()
    s.toggleLibraryManager()
    s.toggleReports()
    s.toggleDrc()
    s.toggleRevisions()
    s.toggleCommandPalette()
    s.toggleCheatsheet()
    s.toggleCalculator()
    s.toggleDocs()
    const st = useUiStore.getState()
    expect(st.libraryManagerOpen).toBe(true)
    expect(st.reportsOpen).toBe(true)
    expect(st.drcOpen).toBe(true)
    expect(st.revisionsOpen).toBe(true)
    expect(st.commandPaletteOpen).toBe(true)
    expect(st.cheatsheetOpen).toBe(true)
    expect(st.calculatorOpen).toBe(true)
    expect(st.docsOpen).toBe(true)
    s.toggleReports()
    expect(useUiStore.getState().reportsOpen).toBe(false)
  })

  it('opens and closes editors', () => {
    useUiStore.getState().openPartEditor({ kind: 'wire' })
    expect(useUiStore.getState().partEditor).toEqual({ kind: 'wire' })
    useUiStore.getState().closePartEditor()
    expect(useUiStore.getState().partEditor).toBeNull()

    useUiStore.getState().openTemplateEditor(null)
    expect(useUiStore.getState().templateEditorId).toBeNull()
    useUiStore.getState().openTemplateEditor('t1')
    expect(useUiStore.getState().templateEditorId).toBe('t1')
    useUiStore.getState().closeTemplateEditor()
    expect(useUiStore.getState().templateEditorId).toBeUndefined()

    useUiStore.getState().openHarnessEditor('h1')
    expect(useUiStore.getState().harnessEditorId).toBe('h1')
    useUiStore.getState().closeHarnessEditor()
    expect(useUiStore.getState().harnessEditorId).toBeNull()
  })

  it('tracks hover harness endpoints', () => {
    useUiStore.getState().setHoverHarness('h1', [{ instanceId: 'i1', portId: 'p1' }])
    expect(useUiStore.getState().hoverHarnessId).toBe('h1')
    expect(useUiStore.getState().hoverEndpoints).toEqual([{ instanceId: 'i1', portId: 'p1' }])
    useUiStore.getState().setHoverHarness(null)
    expect(useUiStore.getState().hoverHarnessId).toBeNull()
    expect(useUiStore.getState().hoverEndpoints).toEqual([])
  })

  it('toggles library collapse and stores search text', () => {
    useUiStore.getState().toggleLibrary()
    expect(useUiStore.getState().libraryCollapsed).toBe(true)
    useUiStore.getState().toggleLibrary()
    expect(useUiStore.getState().libraryCollapsed).toBe(false)
    useUiStore.getState().setLibrarySearch('can')
    expect(useUiStore.getState().librarySearch).toBe('can')
  })

  it('manages DRC index and reconciliation', () => {
    useUiStore.getState().setDrcIndex(4)
    expect(useUiStore.getState().drcIndex).toBe(4)

    const items = {
      parts: [{ id: 'p', kind: 'wire', name: 'W', type: 'COTS', internalPartNumber: '', manufacturer: '', manufacturerPartNumber: '', supplier: '', supplierPartNumber: '' }],
      templates: []
    } as never
    useUiStore.getState().setReconciliation(items)
    expect(useUiStore.getState().showReconciliation).toBe(true)
    expect(useUiStore.getState().reconciliationItems).toBe(items)
    useUiStore.getState().dismissReconciliation()
    expect(useUiStore.getState().showReconciliation).toBe(false)
    expect(useUiStore.getState().reconciliationItems).toEqual({ parts: [], templates: [] })
  })
})
