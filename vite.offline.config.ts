import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))

// Builds what the offline reading runs in the browser (src/offline), as two
// files in public/: the worker (`--mode worker`, a classic script, because a
// service worker may not be a module everywhere) and the module the pages
// load (`--mode client`). The decisions are TypeScript under src/offline and
// tested there. See docs/dev/f37-offline-reading.md.
export default defineConfig(({ mode }) => {
  const worker = mode === 'worker'
  return {
    publicDir: false,
    build: {
      outDir: 'public',
      emptyOutDir: false,
      target: 'es2022',
      lib: {
        entry: resolve(
          HERE,
          worker ? 'src/offline/sw-client.ts' : 'src/offline/offline-client.ts',
        ),
        formats: [worker ? 'iife' : 'es'],
        name: 'slideOffline',
        fileName: () => (worker ? 'offline-sw.js' : 'offline-client.js'),
      },
    },
  }
})
