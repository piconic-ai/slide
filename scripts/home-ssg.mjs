import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { toSSG } from 'hono/ssg'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')

/**
 * Writes the top page into outDir as index.html. Vite loads the page so
 * TSX compiles; `@/components` points at the compiled SSR templates, which
 * carry the hydration markers and register the client scripts.
 */
export async function renderHome(outDir) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: {
      alias: { '@/components': resolve(root, 'dist/components') },
    },
  })
  try {
    const { homeSite } = await server.ssrLoadModule('/src/site/home-page.tsx')
    const result = await toSSG(homeSite, fs, { dir: outDir })
    if (!result.success) throw result.error
    return result.files
  } finally {
    await server.close()
  }
}
