import { contextBridge, ipcRenderer } from 'electron'

const api = {
  library: {
    load: () => ipcRenderer.invoke('library:load'),
    saveParts: (parts: unknown) => ipcRenderer.invoke('library:saveParts', parts),
    saveTemplates: (templates: unknown) =>
      ipcRenderer.invoke('library:saveTemplates', templates)
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
    setDirty: (dirty: boolean) => ipcRenderer.invoke('project:setDirty', dirty)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  bom: {
    export: (csv: string, defaultName: string) =>
      ipcRenderer.invoke('bom:export', csv, defaultName)
  },
  recent: {
    get: () => ipcRenderer.invoke('recent:get'),
    add: (entry: { name: string; path: string }) =>
      ipcRenderer.invoke('recent:add', entry)
  }
}

contextBridge.exposeInMainWorld('ww', api)

export type WwApi = typeof api
