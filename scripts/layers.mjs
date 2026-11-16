// The layer of a source file, read from its name, and what each layer may
// use. See docs/dev/architecture.md. Pure: no file system, no globals.
import ts from 'typescript'

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

/** True when the declaration brings in types only and vanishes when compiled. */
function typesOnly(declaration) {
  if (ts.isExportDeclaration(declaration)) {
    if (declaration.isTypeOnly) return true
    const names = declaration.exportClause
    return (
      names !== undefined &&
      ts.isNamedExports(names) &&
      names.elements.length > 0 &&
      names.elements.every((element) => element.isTypeOnly)
    )
  }
  const clause = declaration.importClause
  // `import './polyfill'` runs the module.
  if (!clause) return false
  if (clause.isTypeOnly) return true
  const names = clause.namedBindings
  return (
    clause.name === undefined &&
    names !== undefined &&
    ts.isNamedImports(names) &&
    names.elements.length > 0 &&
    names.elements.every((element) => element.isTypeOnly)
  )
}

/**
 * The top-level `import` and `export ... from` declarations of a file, read
 * with the TypeScript parser rather than guessed from the text.
 */
function moduleDeclarations(path, source) {
  // The extension decides the grammar: `<T>(value: T) => value` is a generic
  // arrow in .ts and the start of an element in .tsx.
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  return file.statements
    .filter(
      (statement) =>
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier),
    )
    .map((statement) => ({
      module: statement.moduleSpecifier.text,
      typesOnly: typesOnly(statement),
      start: statement.getStart(file),
      end: statement.end,
    }))
}

/** The modules a file loads when it runs. */
export function runtimeImports(path, source) {
  return moduleDeclarations(path, source)
    .filter((declaration) => !declaration.typesOnly)
    .map((declaration) => declaration.module)
}

/** The source without its module declarations, which are judged by name. */
function body(path, source) {
  return moduleDeclarations(path, source)
    .toReversed()
    .reduce(
      (text, { start, end }) => text.slice(0, start) + text.slice(end),
      source,
    )
}

/** The labels of what the file uses although its layer forbids it. */
export function violations(path, source) {
  const rules = RULES[layerOf(path)]
  const modules = runtimeImports(path, source)
  const code = withoutComments(body(path, source))
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
