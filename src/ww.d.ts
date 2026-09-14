import type { Part, PinoutTemplate, Project } from './model/types'

interface LibraryLoadResult {
  parts: Part[]
  templates: PinoutTemplate[]
  isNew: boolean
}

interface LibraryExportResult {
  canceled: boolean
  path?: string
}

interface LibraryImportResult {
  canceled: boolean
  path?: string
  data?: { parts: Part[]; templates: PinoutTemplate[] }
}

interface ImageImportResult {
  hash: string
}

interface ProjectSaveResult {
  canceled: boolean
  path?: string
}

interface ProjectOpenResult {
  canceled: boolean
  path?: string
  data?: Project
}

interface RecentEntry {
  name: string
  path: string
  openedAt: number
}

interface LibraryPackInfo {
  id: string
  name: string
  parts: number
  templates: number
}

interface LibraryPackResult {
  id: string
  data?: { parts?: Part[]; templates?: PinoutTemplate[] } | null
}

interface PartSearchResult {
  id: string
  kind: string
  name: string
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  positions?: number
  gender?: string
}

interface WwApi {
  library: {
    load: () => Promise<LibraryLoadResult>
    saveParts: (parts: Part[]) => Promise<boolean>
    saveTemplates: (templates: PinoutTemplate[]) => Promise<boolean>
    export: (data: { parts: Part[]; templates: PinoutTemplate[] }) => Promise<LibraryExportResult>
    import: () => Promise<LibraryImportResult>
    getPath: () => Promise<string>
    setPath: (path: string) => Promise<string>
    relocatePath: (path: string) => Promise<string>
    choosePath: () => Promise<string | null>
    listPacks: () => Promise<LibraryPackInfo[]>
    readPack: (id: string) => Promise<LibraryPackResult>
  }
  image: {
    import: (dataUrl: string, thumbDataUrl?: string) => Promise<ImageImportResult>
  }
  project: {
    save: (
      path: string | undefined,
      data: Project
    ) => Promise<ProjectSaveResult>
    open: () => Promise<ProjectOpenResult>
    openPath: (path: string) => Promise<ProjectOpenResult>
    setDirty: (dirty: boolean) => Promise<void>
    autosave: (data: Project) => Promise<boolean>
    getRecovery: () => Promise<{
      exists: boolean
      savedAt?: number
      data?: Project
    }>
    clearRecovery: () => Promise<boolean>
  }
  openExternal: (url: string) => Promise<boolean>
  bom: {
    export: (
      csv: string,
      defaultName: string
    ) => Promise<{ canceled: boolean; path?: string }>
  }
  file: {
    exportText: (args: {
      content: string
      defaultName: string
      filterName: string
      extensions: string[]
    }) => Promise<{ canceled: boolean; path?: string }>
    readText: (args: {
      filterName: string
      extensions: string[]
    }) => Promise<{ canceled: boolean; path?: string; content?: string }>
  }
  report: {
    exportPdf: (
      html: string,
      defaultName: string
    ) => Promise<{ canceled: boolean; path?: string }>
  }
  recent: {
    get: () => Promise<RecentEntry[]>
    add: (entry: { name: string; path: string }) => Promise<RecentEntry[]>
  }
  partLookup: {
    search: (query: string) => Promise<PartSearchResult[]>
  }
}

declare global {
  interface Window {
    ww: WwApi
  }
}

export {}
