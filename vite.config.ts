import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { barefoot } from '@barefootjs/hono/vite'
// @ts-expect-error -- a plain ES module without type declarations
import { renderHome } from './scripts/home-ssg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: '/components/',
  resolve: {
    // Mirrors tsconfig.json's `@/components/*` path mapping — Vite's
    // dev-server dependency pre-scan parses raw source directly (before
    // this plugin's own `transform` hook runs) and has no notion of
    // tsconfig `paths` without this. Points at the SOURCE tree (not
    // `dist/components`, the compiled SSR output tsconfig also maps):
    // Vite's client bundler only ever needs to resolve the starter
    // Counter's `@/components/ui/button` import to a real `.tsx` file
    // to bundle, which is always the source one.
    alias: {
      '@/components': resolve(HERE, 'components'),
    },
  },
  // `build.outDir` (`public/components`) is itself a subdirectory of
  // `public/` — Vite's own default `publicDir` behavior would copy
  // `public/`'s OTHER contents (styles.css, tokens.css, favicon.svg,
  // uno.css) into `public/components` too, which nothing reads (Workers
  // Assets already serves them straight from `public/` itself) and
  // which `emptyOutDir` would then immediately churn on the next build.
  publicDir: false,
  build: {
    outDir: 'public/components',
    emptyOutDir: true,
  },
  plugins: [
    barefoot({
      components: ['components'],
      templates: 'dist/components',
    }),
    // The static top page names the hashed client chunks, so it is written
    // after every build, `vite build --watch` included.
    {
      name: 'slide-home-ssg',
      apply: 'build',
      async closeBundle() {
        await renderHome(resolve(HERE, 'public'))
      },
    },
  ],
})
