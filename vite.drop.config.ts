import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))

// Bundles what the drop zone's script decides with into one file,
// public/drop-core.js, which public/drop.js imports. The functions are
// TypeScript under src/drops and tested there; the pages with a drop zone
// are rendered in two ways (the static top page, and the pages of an
// author's slides under a policy that allows no inline script), so both
// load the same plain module rather than a compiled component.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: resolve(HERE, 'src/drops/browser.ts'),
      formats: ['es'],
      fileName: () => 'drop-core.js',
    },
  },
})
