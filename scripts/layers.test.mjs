import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layerOf, runtimeImports, violations } from './layers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Files whose name says "pure" but which reach outside, with what each uses.
 * This list only shrinks: rename or split a file when you touch it, and
 * delete its entry. Never add one; give a new file a name that says its layer.
 */
const KNOWN = {
  'src/auth/config.ts': ['drizzle-orm', 'better-auth', 'env'],
  'src/auth/owner-session.ts': ['hono', 'drizzle-orm', 'env', 'random'],
  'src/preview/config.ts': ['env'],
  'src/preview/stored-file.ts': ['binding'],
  'src/publication/author.ts': ['binding', 'store'],
  'src/site/errors.ts': ['hono', 'env'],
  'src/site/lang.ts': ['hono'],
  'src/site/rate-limit.ts': ['env'],
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

describe('runtimeImports', () => {
  it('Given value imports, a side-effect-free re-export and a namespace import, then each module is listed', () => {
    const source = [
      `import { z } from 'zod'`,
      `import * as schema from '../db/schema'`,
      `export { readDeck } from './store'`,
      `import Default, { type T, value } from './mixed'`,
    ].join('\n')
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([
      'zod',
      '../db/schema',
      './store',
      './mixed',
    ])
  })

  it('Given imports of types only, as the formatter writes them, then none is listed', () => {
    const source = [
      `import type { Context } from 'hono'`,
      `import { type A, type B as C } from './store'`,
      `import {\n  type Context,\n  type MiddlewareHandler,\n  type Env,\n} from 'hono'`,
      `export type { StoredPost } from './store'`,
    ].join('\n')
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([])
  })

  it('Given a type declaration followed by a value import, then the import is still listed', () => {
    const source = `export type Item = { id: string }\nimport { eq } from 'drizzle-orm'\n`
    expect(runtimeImports('src/x/logic.ts', source)).toEqual(['drizzle-orm'])
  })

  it('Given a local export followed by a type import, then the two are separate statements and nothing is listed', () => {
    const source = [
      `const value = 1`,
      `export { value }`,
      `import type { Context } from 'hono'`,
      `export type { Context }`,
    ].join('\n')
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([])
    expect(violations('src/x/logic.ts', source)).toEqual([])
  })

  it('Given double quotes, a side-effect import and a default import, then each module is listed', () => {
    const source = [
      `import { Hono } from "hono"`,
      `import './polyfill'`,
      `import Default from './default'`,
      `export * from './all'`,
    ].join('\n')
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([
      'hono',
      './polyfill',
      './default',
      './all',
    ])
  })

  it('Given an import written inside a string or a template, then it is not listed', () => {
    const source = "const text = `\nimport { Hono } from 'hono'\n`\n"
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([])
  })

  it('Given a .ts file with a generic arrow function, then the declarations after it are still read', () => {
    const source = [
      `export const identity = <T>(value: T): T => value`,
      `export { readDeck } from './store'`,
      `import { eq } from 'drizzle-orm'`,
    ].join('\n')
    expect(runtimeImports('src/x/logic.ts', source)).toEqual([
      './store',
      'drizzle-orm',
    ])
    expect(violations('src/x/logic.ts', source)).toEqual([
      'drizzle-orm',
      'store',
    ])
  })

  it('Given a .tsx file with elements, then its declarations are read', () => {
    const source = [
      `import { Hono } from 'hono'`,
      `export const Page = () => <main><p>{'a'}</p></main>`,
      `export { card } from './store'`,
    ].join('\n')
    expect(runtimeImports('src/x/home-page.tsx', source)).toEqual([
      'hono',
      './store',
    ])
    expect(violations('src/x/home-page.tsx', source)).toEqual(['store'])
  })

  it('Given a file that does not parse, then what can be read is still judged and nothing throws', () => {
    const source = `import { Hono } from 'hono'\nconst = ;;; {{{\n`
    expect(runtimeImports('src/x/logic.ts', source)).toEqual(['hono'])
  })

  it('Given an import inside a comment or an empty file, then nothing is listed', () => {
    expect(
      runtimeImports('src/x/logic.ts', `// import { Hono } from 'hono'\n`),
    ).toEqual([])
    expect(runtimeImports('src/x/logic.ts', '')).toEqual([])
  })
})

describe('violations', () => {
  it.each([
    ['src/x/pages.ts', `import { routes } from './routes'`, ['routes']],
    ['src/x/pages.ts', `import { read } from './store'`, ['store']],
    [
      'src/x/pages.ts',
      `import { get } from '../auth/github-client'`,
      ['client'],
    ],
    [
      'src/x/store.ts',
      `import { get } from '../auth/github-client'`,
      ['client'],
    ],
    ['src/x/store.ts', `import { page } from './pages'`, ['pages']],
    ['src/x/github-client.ts', `import { read } from './store'`, ['store']],
    ['src/x/github-client.ts', `import { page } from './help-page'`, ['pages']],
    ['src/db/schema.ts', `import { read } from '../x/store'`, ['store']],
  ])(
    'Given %s with `%s`, which points against the one-way dependency, then %j is reported',
    (path, line, labels) => {
      expect(violations(path, `${line}\n`)).toEqual(labels)
    },
  )

  it.each([
    ['src/x/pages.ts', `import { card } from '../y/pages'`],
    ['src/x/pages.ts', `import { label } from './state'`],
    ['src/x/logic.ts', `import { card } from './pages'`],
    ['src/x/store.ts', `import { deckSchema } from '../db/schema'`],
    ['src/x/store.ts', `import { other } from '../y/store'`],
    ['src/x/routes.ts', `import { a } from './store'`],
  ])(
    'Given %s with `%s`, which follows the dependency, then nothing is reported',
    (path, line) => {
      expect(violations(path, `${line}\n`)).toEqual([])
    },
  )

  it('Given a type declaration followed by a forbidden import, then the import is reported', () => {
    const source = `export type Item = { id: string }\nimport { eq } from 'drizzle-orm'\n`
    expect(violations('src/x/logic.ts', source)).toEqual(['drizzle-orm'])
  })

  it('Given a multi-line import of types only, then nothing is reported', () => {
    const source = `import {\n  type Context,\n  type Env,\n} from 'hono'\n`
    expect(violations('src/x/logic.ts', source)).toEqual([])
  })

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
    [`import { readUser } from '../auth/github-client'`, 'client'],
    [`import { requireOwner } from '../auth/routes'`, 'routes'],
    [`export const read = (bucket: R2Bucket) => bucket.get('a')`, 'binding'],
    [`export const read = (database: D1Database) => database`, 'binding'],
    [`const keys = createRemoteJWKSet(new URL(issuer))`, 'fetch'],
    [`const now = Date.now() // injected later`, 'clock'],
  ])('Given a pure file with `%s`, then %s is reported', (line, label) => {
    expect(violations('src/x/logic.ts', `${line}\n`)).toEqual([label])
  })

  it.each([
    [`import { html } from 'hono/html'`],
    [`import type { Context } from 'hono'`],
    [`import type {\n  StoredPost,\n} from './store'`],
    [`import { type Context } from 'hono'`],
    [`import { type A, type B as C } from './store'`],
    [`export type { StoredPost } from './store'`],
    [`import { helper } from 'some-library/api'`],
    [`const limit = 5 // Date.now() is the caller's`],
    [`const url = 'https://example.com/store'`],
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

  it('Given an import that mixes a type with a value, then it is still reported', () => {
    const source = `import { type Context, Hono } from 'hono'\n`
    expect(violations('src/x/logic.ts', source)).toEqual(['hono'])
  })

  it('Given the same use in a routes file, then nothing is reported', () => {
    const source = `import { Hono } from 'hono'\nconst now = Date.now()\nawait fetch(c.env.URL)\n`
    expect(violations('src/x/routes.ts', source)).toEqual([])
  })

  it('Given a store that imports hono, calls fetch or reads a route, then each is reported', () => {
    const source = `import { Hono } from 'hono'\nawait fetch(url)\nimport { a } from './routes'\n`
    expect(violations('src/x/store.ts', source)).toEqual([
      'hono',
      'fetch',
      'routes',
    ])
  })

  it('Given a store that takes a database and the time, then nothing is reported', () => {
    const source = `export const save = (database: D1Database) => Date.now()\n`
    expect(violations('src/x/store.ts', source)).toEqual([])
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
