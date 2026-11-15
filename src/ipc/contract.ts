/**
 * The one definition of the main ↔ renderer IPC surface. The main process
 * registers handlers against `IpcChannels`, the preload builds `WwApi` from
 * it, and the renderer sees `window.ww: WwApi`. Payloads are validated again
 * in the main process — the types here describe intent, not trust.
 */
import type { Part, PinoutTemplate } from '../model/types'

export interface Cancelable {
  canceled: boolean
  path?: string
}

export interface LibraryLoadResult {
  parts: Part[]
  templates: PinoutTemplate[]
  isNew: boolean
  /** Present when a library file exists but could not be read. */
  error?: string
  /** Informational note (e.g. a legacy library was merged back in). */
  notice?: string
}

/**
 * A batch of library edits. Only the named records are written/removed on
 * disk; records not mentioned are left untouched.
 */
export interface LibraryChanges {
  upsertParts: Part[]
  removePartIds: string[]
  upsertTemplates: PinoutTemplate[]
  removeTemplateIds: string[]
}

export interface FileReadResult<T = unknown> extends Cancelable {
  data?: T
  /** Human-readable reason the file could not be read. */
  error?: string
}

export interface RecentEntry {
  name: string
  path: string
  openedAt: number
}

export interface RecoveryInfo {
  exists: boolean
  savedAt?: number
  data?: unknown
  /** File the project was last saved to, if any. */
  path?: string
}

export interface LibraryPackInfo {
  id: string
  name: string
  parts: number
  templates: number
}

export interface PartSearchResult {
  id: string
  kind: string
  name: string
  internalPartNumber: string
  manufacturer: string
  manufacturerPartNumber: string
  positions?: number
  gender?: string
}

export type ThemePreference = 'light' | 'dark' | 'system'

/** Commands the native application menu forwards to the renderer. */
export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'reports'
  | 'library'
  | 'docs'
  | 'shortcuts'
  | 'palette'

/** Request/response channels: name → [args, result]. */
export interface IpcChannels {
  'library:load': [[], LibraryLoadResult]
  'library:applyChanges': [[changes: LibraryChanges], boolean]
  'library:export': [[data: { parts: Part[]; templates: PinoutTemplate[] }], Cancelable]
  'library:import': [[], FileReadResult]
  'library:getPath': [[], string]
  'library:setPath': [[path: string], string]
  'library:relocatePath': [[path: string], string]
  'library:choosePath': [[], string | null]
  'library:listPacks': [[], LibraryPackInfo[]]
  'library:readPack': [[id: string], { id: string; data: unknown }]
  'image:import': [[payload: { dataUrl: string; thumbDataUrl?: string }], { hash: string }]
  'project:save': [[args: { path?: string; data: unknown }], Cancelable]
  'project:open': [[], FileReadResult]
  'project:openPath': [[path: string], FileReadResult]
  'project:setDirty': [[dirty: boolean], void]
  'project:autosave': [[args: { data: unknown; path?: string }], boolean]
  'project:getRecovery': [[], RecoveryInfo]
  'project:clearRecovery': [[], boolean]
  'shell:openExternal': [[url: string], boolean]
  'file:exportText': [
    [args: { content: string; defaultName: string; filterName: string; extensions: string[] }],
    Cancelable
  ]
  'file:readText': [
    [args: { filterName: string; extensions: string[] }],
    Cancelable & { content?: string }
  ]
  'report:exportPdf': [[args: { html: string; defaultName: string }], Cancelable]
  'recent:get': [[], RecentEntry[]]
  'recent:add': [[entry: { name: string; path: string }], RecentEntry[]]
  'part-lookup:search': [[query: string], PartSearchResult[]]
  'app:setTheme': [[theme: ThemePreference], void]
  /** A .wwv the OS asked us to open before the renderer was listening. */
  'app:takePendingFile': [[], string | null]
  /** The renderer finished a save requested by the close prompt. */
  'app:closeAfterSave': [[], void]
}

export type IpcChannel = keyof IpcChannels
export type IpcArgs<C extends IpcChannel> = IpcChannels[C][0]
export type IpcResult<C extends IpcChannel> = IpcChannels[C][1]

/** Main → renderer events. */
export interface IpcEvents {
  /** A .wwv was opened from the OS (file association, second instance). */
  'app:openFile': string
  /** The user chose Save in the close prompt; save, then call closeAfterSave. */
  'app:saveAndClose': void
  'menu:command': MenuCommand
}

export interface WwApi {
  library: {
    load: () => Promise<LibraryLoadResult>
    applyChanges: (changes: LibraryChanges) => Promise<boolean>
    export: (data: { parts: Part[]; templates: PinoutTemplate[] }) => Promise<Cancelable>
    import: () => Promise<FileReadResult>
    getPath: () => Promise<string>
    setPath: (path: string) => Promise<string>
    relocatePath: (path: string) => Promise<string>
    choosePath: () => Promise<string | null>
    listPacks: () => Promise<LibraryPackInfo[]>
    readPack: (id: string) => Promise<{ id: string; data: unknown }>
  }
  image: {
    import: (dataUrl: string, thumbDataUrl?: string) => Promise<{ hash: string }>
  }
  project: {
    save: (path: string | undefined, data: unknown) => Promise<Cancelable>
    open: () => Promise<FileReadResult>
    openPath: (path: string) => Promise<FileReadResult>
    setDirty: (dirty: boolean) => Promise<void>
    autosave: (data: unknown, path?: string) => Promise<boolean>
    getRecovery: () => Promise<RecoveryInfo>
    clearRecovery: () => Promise<boolean>
  }
  openExternal: (url: string) => Promise<boolean>
  file: {
    exportText: (args: IpcArgs<'file:exportText'>[0]) => Promise<Cancelable>
    readText: (args: IpcArgs<'file:readText'>[0]) => Promise<Cancelable & { content?: string }>
  }
  report: {
    exportPdf: (html: string, defaultName: string) => Promise<Cancelable>
  }
  recent: {
    get: () => Promise<RecentEntry[]>
    add: (entry: { name: string; path: string }) => Promise<RecentEntry[]>
  }
  partLookup: {
    search: (query: string) => Promise<PartSearchResult[]>
  }
  app: {
    setTheme: (theme: ThemePreference) => Promise<void>
    closeAfterSave: () => Promise<void>
    takePendingFile: () => Promise<string | null>
    /** Subscribe to a main-process event; returns an unsubscribe function. */
    on: <E extends keyof IpcEvents>(event: E, cb: (payload: IpcEvents[E]) => void) => () => void
  }
}
