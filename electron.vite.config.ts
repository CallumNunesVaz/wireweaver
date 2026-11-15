import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
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
  // Exchange rates for the Reports modal's BOM currency conversion (model/fx.ts).
  "connect-src 'self' https://api.frankfurter.app",
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
    build: {
      // electron-vite 6 deprecated `externalizeDepsPlugin()` in favour of the
      // `build.externalizeDeps` option (default true; kept explicit).
      externalizeDeps: true,
      rolldownOptions: {
        input: { index: resolve('electron/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rolldownOptions: {
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
      rolldownOptions: {
        input: { index: resolve('index.html') },
        output: {
          // Split the largest third-party libraries into their own chunks so
          // the entry bundle stays small and vendor code caches across builds.
          // Vite 8 bundles with rolldown, whose `output.manualChunks` is
          // deprecated; the same split is expressed via `codeSplitting.groups`.
          codeSplitting: {
            groups: [
              // Higher priority so React core is captured before @xyflow/react's
              // recursive dependency inclusion can hoist it into the xyflow chunk.
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 10 },
              { name: 'xyflow', test: /node_modules[\\/]@xyflow[\\/]/ },
              { name: 'dagre', test: /node_modules[\\/](dagre|graphlib)[\\/]/ },
              { name: 'fuse', test: /node_modules[\\/]fuse\.js[\\/]/ },
              { name: 'yaml', test: /node_modules[\\/]yaml[\\/]/ }
            ]
          }
        }
      }
    },
    plugins: [react(), injectCsp()]
  }
})
