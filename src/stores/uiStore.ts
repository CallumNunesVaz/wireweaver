import { create } from 'zustand'
import type { Part, PinoutTemplate, PartKind } from '../model/types'

export type LibraryCategory = PartKind | 'pinout'

export interface PartEditorTarget {
  kind: PartKind
  partId?: string // undefined = create new
}

export interface HoverEndpoint {
  instanceId: string
  portId: string
}

interface UiState {
  librarySearch: string
  libraryCollapsed: boolean
  selection: { type: 'instance' | 'harness'; id: string } | null
  /** Instance IDs currently in the multi-selection (Ctrl+click). */
  multiSelectedIds: string[]
  hoverHarnessId: string | null
  /**
   * The hovered harness's endpoints, precomputed when hover starts so device
   * nodes can subscribe to a cheap derived value instead of resolving the
   * harness themselves on every hover change.
   */
  hoverEndpoints: HoverEndpoint[]

  // overlays
  partEditor: PartEditorTarget | null
  templateEditorId: string | null | undefined // undefined = closed, null = new, string = edit
  harnessEditorId: string | null
  libraryManagerOpen: boolean
  reportsOpen: boolean
  drcOpen: boolean
  /** Index of the issue highlighted in the DRC panel (for prev/next nav). */
  drcIndex: number
  revisionsOpen: boolean
  commandPaletteOpen: boolean
  cheatsheetOpen: boolean
  calculatorOpen: boolean
  docsOpen: boolean

  // reconciliation
  showReconciliation: boolean
  reconciliationItems: { parts: Part[]; templates: PinoutTemplate[] }

  setLibrarySearch: (s: string) => void
  toggleLibrary: () => void
  select: (sel: UiState['selection']) => void
  /** Add/remove an instance from the multi-selection (Ctrl+click). */
  toggleMultiSelect: (instanceId: string) => void
  clearMultiSelect: () => void
  setHoverHarness: (id: string | null, endpoints?: HoverEndpoint[]) => void

  openPartEditor: (target: PartEditorTarget) => void
  closePartEditor: () => void
  openTemplateEditor: (id: string | null) => void
  closeTemplateEditor: () => void
  openHarnessEditor: (id: string) => void
  closeHarnessEditor: () => void
  toggleLibraryManager: () => void
  toggleReports: () => void
  toggleDrc: () => void
  setDrcIndex: (i: number) => void
  toggleRevisions: () => void
  toggleCommandPalette: () => void
  toggleCheatsheet: () => void
  toggleCalculator: () => void
  toggleDocs: () => void

  setReconciliation: (items: { parts: Part[]; templates: PinoutTemplate[] }) => void
  dismissReconciliation: () => void
}

export const useUiStore = create<UiState>((set) => ({
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
  reconciliationItems: { parts: [], templates: [] },

  setLibrarySearch: (s) => set({ librarySearch: s }),
  toggleLibrary: () => set((st) => ({ libraryCollapsed: !st.libraryCollapsed })),
  select: (selection) => set({ selection, multiSelectedIds: [] }),
  toggleMultiSelect: (instanceId) =>
    set((st) => {
      const exists = st.multiSelectedIds.includes(instanceId)
      return {
        multiSelectedIds: exists
          ? st.multiSelectedIds.filter((id) => id !== instanceId)
          : [...st.multiSelectedIds, instanceId]
      }
    }),
  clearMultiSelect: () => set({ multiSelectedIds: [] }),
  setHoverHarness: (hoverHarnessId, endpoints) =>
    set({ hoverHarnessId, hoverEndpoints: endpoints ?? [] }),

  openPartEditor: (partEditor) => set({ partEditor }),
  closePartEditor: () => set({ partEditor: null }),
  openTemplateEditor: (id) => set({ templateEditorId: id }),
  closeTemplateEditor: () => set({ templateEditorId: undefined }),
  openHarnessEditor: (harnessEditorId) => set({ harnessEditorId }),
  closeHarnessEditor: () => set({ harnessEditorId: null }),
  toggleLibraryManager: () =>
    set((st) => ({ libraryManagerOpen: !st.libraryManagerOpen })),
  toggleReports: () => set((st) => ({ reportsOpen: !st.reportsOpen })),
  toggleDrc: () => set((st) => ({ drcOpen: !st.drcOpen })),
  setDrcIndex: (drcIndex) => set({ drcIndex }),
  toggleRevisions: () => set((st) => ({ revisionsOpen: !st.revisionsOpen })),
  toggleCommandPalette: () =>
    set((st) => ({ commandPaletteOpen: !st.commandPaletteOpen })),
  toggleCheatsheet: () => set((st) => ({ cheatsheetOpen: !st.cheatsheetOpen })),
  toggleCalculator: () => set((st) => ({ calculatorOpen: !st.calculatorOpen })),

  toggleDocs: () => set((st) => ({ docsOpen: !st.docsOpen })),

  setReconciliation: (items) =>
    set({ showReconciliation: true, reconciliationItems: items }),
  dismissReconciliation: () =>
    set({ showReconciliation: false, reconciliationItems: { parts: [], templates: [] } })
}))
