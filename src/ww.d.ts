import type { Part, PinoutTemplate, Project } from './model/types'

interface LibraryLoadResult {
  parts: Part[]
  templates: PinoutTemplate[]
  isNew: boolean
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

interface WwApi {
  library: {
    load: () => Promise<LibraryLoadResult>
    saveParts: (parts: Part[]) => Promise<boolean>
    saveTemplates: (templates: PinoutTemplate[]) => Promise<boolean>
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
  }
  openExternal: (url: string) => Promise<boolean>
  bom: {
    export: (
      csv: string,
      defaultName: string
    ) => Promise<{ canceled: boolean; path?: string }>
  }
  recent: {
    get: () => Promise<RecentEntry[]>
    add: (entry: { name: string; path: string }) => Promise<RecentEntry[]>
  }
}

declare global {
  interface Window {
    ww: WwApi
  }
}

export {}
