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

/**
 * Packages a layer must not import: a label and the module names it covers.
 * hono/html only builds strings, so every layer may use it.
 */
const HTTP = ['hono', /^hono(\/(?!html$|utils\/html$).*)?$/]
const DATABASE = ['drizzle-orm', /^drizzle-orm(\/.*)?$/]
const AUTH = ['better-auth', /^better-auth(\/.*)?$/]

/** What a layer must not do in its code: a label and the pattern. */
const BINDINGS = ['env', /\bc\.env\.|\benv\.[A-Z][A-Z_]+\b/]
// A D1 or R2 handle passed in is the outside world too.
const HANDLES = ['binding', /\b(D1Database|R2Bucket|KVNamespace)\b/]
const NETWORK = ['fetch', /(?<![.\w])fetch\(|\bcreateRemoteJWKSet\(/]
const CLOCK = ['clock', /\bDate\.now\(|\bnew Date\(\)/]
const RANDOM = [
  'random',
  /\bMath\.random\(|\bcrypto\.(randomUUID|getRandomValues)\(/,
]

/**
 * Per layer: the packages, the uses, and the other layers it must not reach.
 * Dependencies point one way: routes -> pages, store, client -> pure.
 */
const RULES = {
  routes: { packages: [], uses: [], layers: [] },
  store: {
    packages: [HTTP],
    uses: [NETWORK],
    layers: ['client', 'pages', 'routes'],
  },
  client: {
    packages: [HTTP, DATABASE],
    uses: [BINDINGS, HANDLES],
    layers: ['store', 'pages', 'routes'],
  },
  pages: {
    packages: [DATABASE, AUTH],
    // A page may carry a script for the browser, so fetch is not judged.
    uses: [BINDINGS, HANDLES, CLOCK, RANDOM],
    layers: ['store', 'client', 'routes'],
  },
  schema: {
    packages: [HTTP, AUTH],
    uses: [BINDINGS, HANDLES, NETWORK, CLOCK, RANDOM],
    layers: ['store', 'client', 'routes'],
  },
  pure: {
    packages: [HTTP, DATABASE, AUTH],
    uses: [BINDINGS, HANDLES, NETWORK, CLOCK, RANDOM],
    layers: ['store', 'client', 'routes'],
  },
}

export function layerOf(path) {
  return LAYERS.find(([, pattern]) => pattern.test(path))?.[0] ?? 'pure'
}

/** Comments name the things a file avoids; they are not uses. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/ .*$/gm, '')
}

/**
 * `import ... from` and `export ... from`. The clause holds names, braces and
 * commas only, so a declaration such as `export type A = {}` is not taken for
 * the start of the import on the next line.
 */
const FROM = /^(?:import|export)\s+([\w\s{},*$]+?)\s+from\s+'([^']+)'/gm

/** True when the clause brings in types only and vanishes when compiled. */
function typesOnly(clause) {
  if (/^type\s/.test(clause)) return true
  const braces = clause.match(/^\{([\s\S]*)\}$/)
  if (!braces) return false
  const names = braces[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  return names.length > 0 && names.every((name) => /^type\s/.test(name))
}

/** The modules a file loads when it runs. */
export function runtimeImports(source) {
  return [...withoutComments(source).matchAll(FROM)]
    .filter(([, clause]) => !typesOnly(clause.trim()))
    .map(([, , module]) => module)
}

/** The labels of what the file uses although its layer forbids it. */
export function violations(path, source) {
  const rules = RULES[layerOf(path)]
  const modules = runtimeImports(source)
  const code = withoutComments(source).replace(FROM, '')
  const relative = modules.filter((module) => module.startsWith('.'))
  return [
    ...rules.packages
      .filter(([, pattern]) => modules.some((module) => pattern.test(module)))
      .map(([label]) => label),
    ...rules.uses
      .filter(([, pattern]) => pattern.test(code))
      .map(([label]) => label),
    ...rules.layers.filter((layer) =>
      relative.some((module) => layerOf(`${module}.ts`) === layer),
    ),
  ]
}
