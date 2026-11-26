// What a source file does with a subscriber's email address, read from its
// syntax: which columns that hold one it names, and whether it reads an
// `email` off an object (what Better Auth returns for a user, an invitation
// record, a form). Pure: no file system, no globals. The declaration it is
// judged against is src/privacy/email-exposure.ts; what it cannot see is
// written in docs/dev/f43-email-handling.md.
import ts from 'typescript'

/** The id of a touch that is not a column: an `email` read off an object. */
export const OBJECT_EMAIL = '.email'

const parse = (path, source) =>
  ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('sx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/** The identifiers and the string literals inside an expression. */
function wordsOf(node) {
  const found = []
  const visit = (child) => {
    if (ts.isIdentifier(child) || ts.isStringLiteralLike(child))
      found.push(child.text)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/** The text of a string or a template, with its substitutions left out. */
function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map((s) => s.literal.text),
    ].join(' ')
  return null
}

const containsWord = (text, name) => new RegExp(`\\b${name}\\b`, 'i').test(text)

/** The names a file gives what it imports: `import { a as b }` maps b to a. */
function importedNames(file) {
  const names = new Map()
  for (const statement of file.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        names.set(element.name.text, {
          name: (element.propertyName ?? element.name).text,
          module: statement.moduleSpecifier.text,
        })
  }
  return names
}

/** True when `module`, written in `path`, is the file `target` (`src/a/b.ts`). */
function isModule(path, module, target) {
  if (!module.startsWith('.')) return false
  const parts = path.split('/').slice(0, -1)
  for (const part of module.split('/'))
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  return `${parts.join('/')}.ts` === target
}

/** `authUser.email`, where `authUser` is what the file imported: its column id. */
function drizzleColumn(node, { imported, columnOf }) {
  const receiver = node.expression
  const table = ts.isIdentifier(receiver)
    ? imported.get(receiver.text)
    : undefined
  return table && columnOf.get(`${table.name}.${node.name.text}`)
}

/** The touches of a property access: a column, or an object's `email`. */
function propertyTouches(node, context) {
  const column = drizzleColumn(node, context)
  if (column) return [column]
  const ignored = wordsOf(node.expression).some((word) =>
    context.ignoredReceivers.includes(word),
  )
  return node.name.text === 'email' && !ignored ? [OBJECT_EMAIL] : []
}

/** `const { email } = user`, `({ email }) => ...`: an object's `email` taken apart. */
function bindingTouches(node, file) {
  const taken =
    ts.isBindingElement(node) &&
    ts.isObjectBindingPattern(node.parent) &&
    (node.propertyName ?? node.name).getText(file) === 'email'
  return taken ? [OBJECT_EMAIL] : []
}

/** Importing a function that returns an address is reading the column it reads. */
function accessorTouches(node, path, accessors) {
  const module = node.parent.parent.parent.moduleSpecifier.text
  const name = (node.propertyName ?? node.name).text
  return accessors
    .filter(
      (accessor) =>
        accessor.name === name && isModule(path, module, accessor.module),
    )
    .map((accessor) => accessor.touches)
}

/** A string or template that names a table and one of its columns. */
function sqlTouches(node, columns) {
  const text = literalText(node)
  if (text === null) return []
  return columns
    .filter(
      ({ table, column }) =>
        containsWord(text, table) && containsWord(text, column),
    )
    .map(({ table, column }) => `${table}.${column}`)
}

/**
 * The touches of one file, sorted and without repeats: ids like
 * `auth_user.email` (a column, named by its drizzle expression, by a SQL
 * string, or by a function that returns it) and `.email` (an object's
 * `email`, read or taken apart).
 *
 * - `columns`: the subscriber columns, `{ table, column, drizzle }`.
 * - `ignoredReceivers`: names whose `.email` is not a subscriber's address
 *   (an operator's own, a validator's constructor).
 * - `accessors`: `{ module, name, touches }` of functions that return an
 *   address, with the id of the column they read.
 */
export function touchesOf(
  path,
  source,
  { columns, ignoredReceivers, accessors },
) {
  const file = parse(path, source)
  const context = {
    imported: importedNames(file),
    columnOf: new Map(
      columns.map(({ drizzle, table, column }) => [
        drizzle,
        `${table}.${column}`,
      ]),
    ),
    ignoredReceivers,
  }
  const found = new Set()
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node))
      for (const id of propertyTouches(node, context)) found.add(id)
    if (ts.isImportSpecifier(node))
      for (const id of accessorTouches(node, path, accessors)) found.add(id)
    for (const id of [
      ...bindingTouches(node, file),
      ...sqlTouches(node, columns),
    ])
      found.add(id)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found].toSorted()
}
