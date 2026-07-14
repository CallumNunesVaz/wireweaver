import { create } from 'zustand'
import type { PartKind } from '../model/types'

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

  setLibrarySearch: (s: string) => void
  toggleLibrary: () => void
  select: (sel: UiState['selection']) => void
  setHoverHarness: (id: string | null, endpoints?: HoverEndpoint[]) => void

  openPartEditor: (target: PartEditorTarget) => void
  closePartEditor: () => void
  openTemplateEditor: (id: string | null) => void
  closeTemplateEditor: () => void
  openHarnessEditor: (id: string) => void
  closeHarnessEditor: () => void
  toggleLibraryManager: () => void
}

export const useUiStore = create<UiState>((set) => ({
  librarySearch: '',
  libraryCollapsed: false,
  selection: null,
  hoverHarnessId: null,
  hoverEndpoints: [],

  partEditor: null,
  templateEditorId: undefined,
  harnessEditorId: null,
  libraryManagerOpen: false,

  setLibrarySearch: (s) => set({ librarySearch: s }),
  toggleLibrary: () => set((st) => ({ libraryCollapsed: !st.libraryCollapsed })),
  select: (selection) => set({ selection }),
  setHoverHarness: (hoverHarnessId, endpoints) =>
    set({ hoverHarnessId, hoverEndpoints: endpoints ?? [] }),

  openPartEditor: (partEditor) => set({ partEditor }),
  closePartEditor: () => set({ partEditor: null }),
  openTemplateEditor: (id) => set({ templateEditorId: id }),
  closeTemplateEditor: () => set({ templateEditorId: undefined }),
  openHarnessEditor: (harnessEditorId) => set({ harnessEditorId }),
  closeHarnessEditor: () => set({ harnessEditorId: null }),
  toggleLibraryManager: () =>
    set((st) => ({ libraryManagerOpen: !st.libraryManagerOpen }))
}))
