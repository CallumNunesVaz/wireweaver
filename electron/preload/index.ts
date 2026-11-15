import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcEvents, IpcResult, WwApi } from '../../src/ipc/contract'

const invoke = <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> =>
  ipcRenderer.invoke(channel, ...args)

const EVENTS: ReadonlySet<string> = new Set<keyof IpcEvents>([
  'app:openFile',
  'app:saveAndClose',
  'menu:command'
])

const api: WwApi = {
  library: {
    load: () => invoke('library:load'),
    applyChanges: (changes) => invoke('library:applyChanges', changes),
    export: (data) => invoke('library:export', data),
    import: () => invoke('library:import'),
    getPath: () => invoke('library:getPath'),
    setPath: (path) => invoke('library:setPath', path),
    relocatePath: (path) => invoke('library:relocatePath', path),
    choosePath: () => invoke('library:choosePath'),
    listPacks: () => invoke('library:listPacks'),
    readPack: (id) => invoke('library:readPack', id)
  },
  image: {
    import: (dataUrl, thumbDataUrl) => invoke('image:import', { dataUrl, thumbDataUrl })
  },
  project: {
    save: (path, data) => invoke('project:save', { path, data }),
    open: () => invoke('project:open'),
    openPath: (path) => invoke('project:openPath', path),
    setDirty: (dirty) => invoke('project:setDirty', dirty),
    autosave: (data, path) => invoke('project:autosave', { data, path }),
    getRecovery: () => invoke('project:getRecovery'),
    clearRecovery: () => invoke('project:clearRecovery')
  },
  openExternal: (url) => invoke('shell:openExternal', url),
  file: {
    exportText: (args) => invoke('file:exportText', args),
    readText: (args) => invoke('file:readText', args)
  },
  report: {
    exportPdf: (html, defaultName) => invoke('report:exportPdf', { html, defaultName })
  },
  recent: {
    get: () => invoke('recent:get'),
    add: (entry) => invoke('recent:add', entry)
  },
  partLookup: {
    search: (query) => invoke('part-lookup:search', query)
  },
  app: {
    setTheme: (theme) => invoke('app:setTheme', theme),
    closeAfterSave: () => invoke('app:closeAfterSave'),
    takePendingFile: () => invoke('app:takePendingFile'),
    on: (event, cb) => {
      if (!EVENTS.has(event)) throw new Error(`Unknown event ${String(event)}`)
      const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload as never)
      ipcRenderer.on(event, listener)
      return () => ipcRenderer.removeListener(event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('ww', api)
