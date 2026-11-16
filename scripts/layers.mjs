// The layer of a source file, read from its name, and what each layer may
// use. See docs/dev/architecture.md. Pure: no file system, no globals.

/** Layers, from the name of a file under src/. The first match wins. */
const LAYERS = [
  ['routes', /(^|[-/])(routes|api|middleware)\.tsx?$/],
  ['store', /(^|[-/])store\.ts$/],
  ['client', /(^|[-/])client\.ts$/],
  ['pages', /(^|[-/])pages?\.tsx?$/],
  ['schema', /(^|[-/])schema\.ts$/],
]

/** What a layer must not use: a label and the pattern that finds it. */
// hono/html only builds strings, so every layer may use it.
const HTTP = ['hono', /from 'hono(\/(?!html'|utils\/html')[^']*)?'/]
const DATABASE = ['drizzle-orm', /from 'drizzle-orm[^']*'/]
const AUTH = ['better-auth', /from 'better-auth[^']*'/]
const BINDINGS = ['env', /\bc\.env\.|\benv\.[A-Z][A-Z_]+\b/]
const NETWORK = ['fetch', /(?<![.\w])fetch\(|\bcreateRemoteJWKSet\(/]
// A D1 or R2 handle passed in is the outside world too.
const HANDLES = ['binding', /\b(D1Database|R2Bucket|KVNamespace)\b/]
const CLOCK = ['clock', /\bDate\.now\(|\bnew Date\(\)/]
const RANDOM = [
  'random',
  /\bMath\.random\(|\bcrypto\.(randomUUID|getRandomValues)\(/,
]
const STORE = ['store', /from '\.[^']*[-/]store'/]
const CLIENT = ['client', /from '\.[^']*[-/]client'/]
const ROUTES = ['routes', /from '\.[^']*[-/](routes|api|middleware)'/]

const FORBIDDEN = {
  routes: [],
  store: [HTTP, NETWORK, ROUTES],
  client: [HTTP, DATABASE, BINDINGS, HANDLES, STORE, ROUTES],
  // A page may carry a script for the browser, so fetch is not judged here.
  pages: [DATABASE, AUTH, BINDINGS, HANDLES, CLOCK, RANDOM, CLIENT],
  schema: [
    HTTP,
    AUTH,
    BINDINGS,
    HANDLES,
    NETWORK,
    CLOCK,
    RANDOM,
    STORE,
    CLIENT,
    ROUTES,
  ],
  pure: [
    HTTP,
    DATABASE,
    AUTH,
    BINDINGS,
    HANDLES,
    NETWORK,
    CLOCK,
    RANDOM,
    STORE,
    CLIENT,
    ROUTES,
  ],
}

export function layerOf(path) {
  return LAYERS.find(([, pattern]) => pattern.test(path))?.[0] ?? 'pure'
}

/** `import { type A, type B } from` brings in types only, like `import type`. */
const TYPES_ONLY =
  /^(import|export) (type [^;]*?|\{(\s*type \w+( as \w+)?\s*,?)+\}) from '[^']*'/gm

/**
 * Comments name the things a file avoids, and type imports vanish when
 * compiled; neither is a use. The formatter keeps imports single-quoted.
 */
function judged(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/ .*$/gm, '')
    .replace(TYPES_ONLY, '')
}

/** The labels of what the file uses although its layer forbids it. */
export function violations(path, source) {
  const code = judged(source)
  return FORBIDDEN[layerOf(path)]
    .filter(([, pattern]) => pattern.test(code))
    .map(([label]) => label)
}
