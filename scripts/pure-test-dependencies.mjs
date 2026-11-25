// Check the runtime dependency graph of pure tests, including test helpers.
import { basename, dirname, extname, join } from 'node:path/posix'
import ts from 'typescript'
import { layerOf, runtimeImports } from './layers.mjs'

const runtimeModules = [
  'wrangler',
  'workerd',
  'miniflare',
  'playwright',
  'playwright-core',
  '@playwright/test',
  '@cloudflare/vitest-pool-workers',
  '@cloudflare/puppeteer',
  '@barefootjs/test',
  'fs',
  'child_process',
  'worker_threads',
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'dns',
  'os',
  'timers',
  'process',
  'sqlite',
  'perf_hooks',
]

function externalRuntime(specifier) {
  const name = specifier.replace(/^node:/, '')
  return (
    name.startsWith('cloudflare:') ||
    runtimeModules.some(
      (module) => name === module || name.startsWith(module + '/'),
    )
  )
}

const globalEffects = new Set([
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'setTimeout',
  'setInterval',
  'AbortSignal.timeout',
  'Date.now',
  'performance.now',
  'Math.random',
  'crypto.randomUUID',
  'crypto.getRandomValues',
  'process.cwd',
  'process.hrtime',
  'vi.useFakeTimers',
  'vi.setSystemTime',
])

function memberName(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    return memberName(node.expression) + '.' + node.name.text
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return memberName(node.expression) + '.' + node.argumentExpression.text
  }
  return ''
}

const randomCrypto =
  /^(random(?:Bytes|UUID|Int|Fill|FillSync)|getRandomValues|generate(?:Key|KeyPair|Prime)(?:Sync)?)$/

function cryptoEffects(statement) {
  if (!/^(?:node:)?crypto$/.test(statement.moduleSpecifier?.text)) return []
  if (statement.isTypeOnly || statement.importClause?.isTypeOnly) return []
  const named = statement.exportClause ?? statement.importClause?.namedBindings
  return (named?.elements ?? [])
    .filter((entry) => !entry.isTypeOnly)
    .map((entry) => (entry.propertyName ?? entry.name).text)
    .filter((name) => randomCrypto.test(name))
    .map((name) => 'crypto.' + name)
}

const bindings = /^(.+\.)?env\.(DB|UPLOADS|ASSETS|BROWSER)$/

function inspectCall(node, modules, effects) {
  const name = memberName(node.expression).replace(/^globalThis\./, '')
  if (globalEffects.has(name)) effects.add(name)
  if (
    (modules.has('node:crypto') || modules.has('crypto')) &&
    randomCrypto.test(name.split('.').at(-1))
  )
    effects.add(name)
  if (name === 'Date' && (ts.isCallExpression(node) || !node.arguments?.length))
    effects.add('clock')
  if (
    node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
    name !== 'require'
  )
    return
  const specifier = node.arguments?.[0]
  if (specifier && ts.isStringLiteralLike(specifier))
    modules.add(specifier.text)
  else effects.add('computed module import')
}

function inspect(path, source) {
  const modules = new Set(runtimeImports(path, source))
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest)
  const effects = new Set(file.statements.flatMap(cryptoEffects))
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node))
      inspectCall(node, modules, effects)
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const name = memberName(node).replace(/^globalThis\./, '')
      if (name === 'process.env' || bindings.test(name)) effects.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { modules, effects }
}

function localPath(path, specifier, sources) {
  const target = specifier.startsWith('@/')
    ? specifier.slice(2)
    : join(dirname(path), specifier)
  const bare = target.replace(/\.[cm]?jsx?$/, '')
  return [
    target,
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].flatMap(
      (ext) => [bare + ext, join(target, 'index' + ext)],
    ),
  ].find((candidate) => sources.has(candidate))
}

function dependenciesOf(path, sources) {
  const { modules, effects } = inspect(path, sources.get(path))
  const dependencies = []
  for (const specifier of modules) {
    if (externalRuntime(specifier)) effects.add(specifier)
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
    const dependency = localPath(path, specifier, sources)
    if (dependency) dependencies.push(dependency)
    else if (extname(specifier) !== '.json')
      effects.add('unresolved import ' + specifier)
  }
  return { dependencies, effects }
}

/** Reports misclassified suites, including the chain to the first boundary. */
export function pureTestViolations(sources) {
  const graph = new Map()
  function boundaryPath(path, seen) {
    if (seen.has(path)) return
    seen.add(path)
    if (['store', 'client', 'routes'].includes(layerOf(path))) return [path]
    if (!graph.has(path)) graph.set(path, dependenciesOf(path, sources))
    const { effects, dependencies } = graph.get(path)
    if (effects.size) return [path, effects.values().next().value]
    for (const dependency of dependencies) {
      const trail = boundaryPath(dependency, seen)
      if (trail) return [path, ...trail]
    }
  }
  const violations = []
  for (const path of sources.keys()) {
    const stem = basename(path).match(/^(.*)\.(?:test|spec)\.[cm]?[jt]sx?$/)?.[1]
    if (!stem || /\.(integration|performance|browser)$/.test(stem)) continue
    const boundary = boundaryPath(path, new Set())
    if (stem.endsWith('.pure')) {
      if (boundary) violations.push(boundary)
    } else if (!boundary) {
      violations.push([
        path,
        'use .pure.test for a suite without runtime dependencies',
      ])
    }
  }
  return violations
}
