import { contextBridge, ipcRenderer } from 'electron'

const api = {
  library: {
    load: () => ipcRenderer.invoke('library:load'),
    saveParts: (parts: unknown) => ipcRenderer.invoke('library:saveParts', parts),
    saveTemplates: (templates: unknown) =>
      ipcRenderer.invoke('library:saveTemplates', templates),
    export: (data: unknown) => ipcRenderer.invoke('library:export', data),
    import: () => ipcRenderer.invoke('library:import'),
    getPath: () => ipcRenderer.invoke('library:getPath'),
    setPath: (path: string) => ipcRenderer.invoke('library:setPath', path),
    relocatePath: (path: string) => ipcRenderer.invoke('library:relocatePath', path),
    choosePath: () => ipcRenderer.invoke('library:choosePath'),
    listPacks: () => ipcRenderer.invoke('library:listPacks'),
    readPack: (id: string) => ipcRenderer.invoke('library:readPack', id)
  },
  image: {
    import: (dataUrl: string, thumbDataUrl?: string) =>
      ipcRenderer.invoke('image:import', { dataUrl, thumbDataUrl })
  },
  project: {
    save: (path: string | undefined, data: unknown) =>
      ipcRenderer.invoke('project:save', { path, data }),
    open: () => ipcRenderer.invoke('project:open'),
    openPath: (path: string) => ipcRenderer.invoke('project:openPath', path),
    setDirty: (dirty: boolean) => ipcRenderer.invoke('project:setDirty', dirty),
    autosave: (data: unknown) => ipcRenderer.invoke('project:autosave', data),
    getRecovery: () => ipcRenderer.invoke('project:getRecovery'),
    clearRecovery: () => ipcRenderer.invoke('project:clearRecovery')
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  bom: {
    export: (csv: string, defaultName: string) =>
      ipcRenderer.invoke('bom:export', csv, defaultName)
  },
  file: {
    exportText: (args: {
      content: string
      defaultName: string
      filterName: string
      extensions: string[]
    }) => ipcRenderer.invoke('file:exportText', args),
    readText: (args: { filterName: string; extensions: string[] }) =>
      ipcRenderer.invoke('file:readText', args)
  },
  report: {
    exportPdf: (html: string, defaultName: string) =>
      ipcRenderer.invoke('report:exportPdf', { html, defaultName })
  },
  recent: {
    get: () => ipcRenderer.invoke('recent:get'),
    add: (entry: { name: string; path: string }) =>
      ipcRenderer.invoke('recent:add', entry)
  },
  partLookup: {
    search: (query: string) => ipcRenderer.invoke('part-lookup:search', query)
  }
}

contextBridge.exposeInMainWorld('ww', api)

export type WwApi = typeof api
