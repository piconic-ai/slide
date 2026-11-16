import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layerOf, violations } from './layers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Files whose name says "pure" but which reach outside, with what each uses.
 * This list only shrinks: rename or split a file when you touch it, and
 * delete its entry. Never add one; give a new file a name that says its layer.
 */
const KNOWN = {
  'src/auth/config.ts': ['drizzle-orm', 'better-auth', 'env', 'clock'],
  'src/auth/owner-session.ts': ['hono', 'drizzle-orm', 'env', 'random'],
  'src/covers/serve.ts': ['env', 'store'],
  'src/decks/bind.ts': ['env', 'clock', 'store'],
  'src/decks/deletion.ts': ['drizzle-orm', 'env', 'random'],
  'src/preview/config.ts': ['env'],
  'src/preview/content.ts': ['hono', 'env', 'fetch', 'clock', 'store'],
  'src/publication/author.ts': ['store'],
  'src/publication/ci.ts': ['drizzle-orm', 'store'],
  'src/reactions/bluesky.ts': ['fetch'],
  'src/reactions/record.ts': ['env', 'store'],
  'src/site/errors.ts': ['hono', 'env'],
  'src/site/lang.ts': ['hono'],
  'src/site/rate-limit.ts': ['env'],
  'src/uploads/cleanup.ts': ['drizzle-orm', 'env'],
}

describe('layerOf', () => {
  it.each([
    ['src/decks/routes.ts', 'routes'],
    ['src/site/settings-routes.ts', 'routes'],
    ['src/uploads/api.ts', 'routes'],
    ['src/site/middleware.ts', 'routes'],
    ['src/decks/store.ts', 'store'],
    ['src/uploads/start-store.ts', 'store'],
    ['src/auth/github-client.ts', 'client'],
    ['src/share/pages.ts', 'pages'],
    ['src/site/help-page.ts', 'pages'],
    ['src/site/home-page.tsx', 'pages'],
    ['src/db/schema.ts', 'schema'],
    ['src/db/auth-schema.ts', 'schema'],
    ['src/uploads/inventory.ts', 'pure'],
  ])('Given %s, then its layer is %s', (path, layer) => {
    expect(layerOf(path)).toBe(layer)
  })

  it.each([
    'src/decks/restore.ts',
    'src/site/homepages.ts',
    'src/uploads/rapid.ts',
    'src/share/client-hints.ts',
  ])(
    'Given %s, whose name only contains a layer word, then it is pure',
    (path) => {
      expect(layerOf(path)).toBe('pure')
    },
  )
})

describe('violations', () => {
  it('Given a pure file that only transforms its input, then nothing is reported', () => {
    const source = `import { z } from 'zod'\nexport const twice = (n) => n * 2\n`
    expect(violations('src/x/twice.ts', source)).toEqual([])
  })

  it.each([
    [`import { Hono } from 'hono'`, 'hono'],
    [`import { setCookie } from 'hono/cookie'`, 'hono'],
    [`import { eq } from 'drizzle-orm'`, 'drizzle-orm'],
    [`import { drizzle } from 'drizzle-orm/d1'`, 'drizzle-orm'],
    [`import { betterAuth } from 'better-auth'`, 'better-auth'],
    [`const origin = c.env.PUBLIC_ORIGIN`, 'env'],
    [`const origin = env.PUBLIC_ORIGIN`, 'env'],
    [`const response = await fetch(url)`, 'fetch'],
    [`const now = Date.now()`, 'clock'],
    [`const now = new Date()`, 'clock'],
    [`const pick = Math.random()`, 'random'],
    [`const id = crypto.randomUUID()`, 'random'],
    [`import { readDeck } from './store'`, 'store'],
    [`import { readDeck } from '../decks/history-store'`, 'store'],
  ])('Given a pure file with `%s`, then %s is reported', (line, label) => {
    expect(violations('src/x/logic.ts', `${line}\n`)).toEqual([label])
  })

  it.each([
    [`import { html } from 'hono/html'`],
    [`import type { Context } from 'hono'`],
    [`import type {\n  StoredPost,\n} from './store'`],
    [`// Never calls fetch( or reads c.env.DB here`],
    [`/* Date.now() is passed in by the caller */`],
    [`const text = 'Router order, c.env, typing Bindings'`],
    [`const at = new Date(seconds * 1000)`],
    [`const hash = await crypto.subtle.digest('SHA-256', bytes)`],
    [`const next = refetch(url)`],
    [`const next = client.fetch(url)`],
  ])('Given a pure file with `%s`, then nothing is reported', (line) => {
    expect(violations('src/x/logic.ts', `${line}\n`)).toEqual([])
  })

  it('Given the same use in a routes file, then nothing is reported', () => {
    const source = `import { Hono } from 'hono'\nconst now = Date.now()\nawait fetch(c.env.URL)\n`
    expect(violations('src/x/routes.ts', source)).toEqual([])
  })

  it('Given a store that imports hono or calls fetch, then both are reported', () => {
    const source = `import { Hono } from 'hono'\nawait fetch(url)\n`
    expect(violations('src/x/store.ts', source)).toEqual(['hono', 'fetch'])
  })

  it('Given a page that reads the database, then it is reported, but a browser script that fetches is not', () => {
    expect(
      violations('src/x/pages.ts', `import { eq } from 'drizzle-orm'\n`),
    ).toEqual(['drizzle-orm'])
    expect(
      violations('src/x/pages.ts', `const script = 'await fetch(url)'\n`),
    ).toEqual([])
  })

  it('Given an empty file, then nothing is reported', () => {
    expect(violations('src/x/empty.ts', '')).toEqual([])
  })
})

describe('the source tree', () => {
  const files = readdirSync(join(ROOT, 'src'), { recursive: true })
    .map((file) => `src/${String(file).replaceAll('\\', '/')}`)
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !/\.test\.|\.d\.ts$|\/test-[^/]*$/.test(path))
  const found = Object.fromEntries(
    files
      .map((path) => [
        path,
        violations(path, readFileSync(join(ROOT, path), 'utf8')),
      ])
      .filter(([, labels]) => labels.length > 0),
  )

  it('When every source file is judged by its name, then only the known files reach outside their layer, and exactly as recorded', () => {
    expect(found).toEqual(KNOWN)
  })
})
