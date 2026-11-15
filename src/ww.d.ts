import type { WwApi } from './ipc/contract'

// The renderer's view of the preload bridge. The contract lives in
// src/ipc/contract.ts and is shared with the main and preload processes.
declare global {
  interface Window {
    ww: WwApi
  }
}

export {}
