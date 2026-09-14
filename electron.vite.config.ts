import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict CSP for the packaged app (origin ww://app). Injected only at build
// time because the Vite dev server needs its inline react-refresh preamble.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' ww: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function injectCsp(): Plugin {
  return {
    name: 'ww-inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('index.html') },
        output: {
          // Split the largest third-party libraries into their own chunks so
          // the entry bundle stays small and vendor code caches across builds.
          manualChunks(id: string) {
            if (!id.includes('/node_modules/')) return undefined
            if (id.includes('@xyflow')) return 'xyflow'
            if (id.includes('/dagre/') || id.includes('/graphlib/')) return 'dagre'
            if (id.includes('/fuse.js/')) return 'fuse'
            if (id.includes('/yaml/')) return 'yaml'
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'react'
            }
            return undefined
          }
        }
      }
    },
    plugins: [react(), injectCsp()]
  }
})
