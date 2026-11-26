// Judges the source against the declaration of where an email address may be
// kept, read and shown (src/privacy/email-exposure.ts, F43). Each function
// takes plain data and returns the problems it finds, as sentences that say
// which file or column, where the declaration is, and what to check before
// adding to it. Pure: the tests read the tree and the app and pass it in.
import { routePattern, uncovered } from './email-exposure-routes.mjs'

export const DECLARATION_FILE = 'src/privacy/email-exposure.ts'

/** What to settle before a place is added to the declaration. */
const BEFORE_ADDING = `Before you add it to ${DECLARATION_FILE}, check that the address is not shown anywhere outside the places that file lists as allowed, and that a user id or a keyed hash (src/auth/login-keys.ts) would not do instead. Adding it is allowed; give it one sentence of reason.`

const KINDS = ['subscriber', 'operator', 'keyed-hash', 'not-an-address']

const idOf = ({ table, column }) => `${table}.${column}`

/** A reason is one sentence: not empty, ends with a full stop, holds no other. */
export function isOneSentence(reason) {
  if (typeof reason !== 'string') return false
  const text = reason.trim()
  return (
    text.length > 0 &&
    !text.includes('\n') &&
    text.endsWith('.') &&
    !/[.!?]\s/.test(text.replace(/\(.*?\)|`.*?`/g, ''))
  )
}

/**
 * The columns (F43-AC1). `schemaColumns` are `{ table, column, drizzle }` for
 * every column of every table, `drizzle` being how the schema is imported
 * (`authUser.email`); `declared` is ADDRESS_COLUMNS; `named` is the pattern
 * for the names that must be declared.
 */
export function columnProblems({ schemaColumns, declared, named }) {
  const problems = []
  const known = new Map(schemaColumns.map((column) => [idOf(column), column]))
  const seen = new Set()
  for (const column of declared) {
    const id = idOf(column)
    if (seen.has(id))
      problems.push(`${id} is declared twice in ${DECLARATION_FILE}.`)
    seen.add(id)
    if (!KINDS.includes(column.kind))
      problems.push(
        `${id} has the kind "${column.kind}", which is none of ${KINDS.join(', ')}.`,
      )
    const real = known.get(id)
    if (!real)
      problems.push(
        `${id} is declared in ${DECLARATION_FILE} but the schema has no such column; remove it or fix its name.`,
      )
    else if (column.kind === 'subscriber' && column.drizzle !== real.drizzle)
      problems.push(
        `${id} is declared as ${column.drizzle} but the schema exports it as ${real.drizzle}; the scan looks for the name in the declaration.`,
      )
  }
  for (const column of schemaColumns)
    if (named.test(column.column) && !seen.has(idOf(column)))
      problems.push(
        `The column ${idOf(column)} is named like an address (${named}) and is not in ${DECLARATION_FILE}, so it is not known whether it holds a subscriber's address, an operator's, a keyed hash, or none. ${BEFORE_ADDING}`,
      )
  return problems
}

/** Reasons and scenes are written, and a reason is one sentence (F43-AC3). */
export function reasonProblems({
  columns,
  readers,
  exposures,
  ignoredReceivers,
}) {
  const problems = []
  const judge = (what, reason) => {
    if (!isOneSentence(reason))
      problems.push(
        `${what} has ${reason ? 'a reason that is not one sentence' : 'no reason'} in ${DECLARATION_FILE}: write why in one sentence that ends with a full stop.`,
      )
  }
  for (const column of columns)
    judge(`The column ${idOf(column)}`, column.reason)
  for (const reader of readers) judge(`The file ${reader.file}`, reader.reason)
  for (const exposure of exposures) {
    judge(`The place "${exposure.id}"`, exposure.reason)
    for (const lang of ['ja', 'en'])
      if (!exposure.scene?.[lang]?.trim())
        problems.push(
          `The place "${exposure.id}" has no ${lang} scene in ${DECLARATION_FILE}; the help article tells subscribers of it with that sentence.`,
        )
  }
  for (const receiver of ignoredReceivers)
    judge(`The receiver "${receiver.name}"`, receiver.reason)
  return problems
}

/** The files that touch an address and are not declared, or touch more than declared. */
export function undeclaredProblems({ touches, readers }) {
  const declared = new Map(readers.map((reader) => [reader.file, reader]))
  const problems = readers
    .filter(
      (reader, index) =>
        readers.findIndex((r) => r.file === reader.file) !== index,
    )
    .map((reader) => `${reader.file} is declared twice in ${DECLARATION_FILE}.`)
  for (const [file, found] of [...touches].toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (found.length === 0) continue
    const reader = declared.get(file)
    const added = reader
      ? found.filter((id) => !reader.touches.includes(id))
      : found
    if (!reader)
      problems.push(
        `${file} touches ${found.join(', ')} (a subscriber's email address) and is not among the files ${DECLARATION_FILE} lets read it. ${BEFORE_ADDING}`,
      )
    else if (added.length > 0)
      problems.push(
        `${file} now also touches ${added.join(', ')}, which ${DECLARATION_FILE} does not list for it. ${BEFORE_ADDING}`,
      )
  }
  return problems
}

/** The declared files that are gone, or no longer touch what is declared. */
export function staleProblems({ touches, readers }) {
  const problems = []
  for (const reader of readers) {
    const found = touches.get(reader.file)
    if (!found) {
      problems.push(
        `${DECLARATION_FILE} lets ${reader.file} read an address, and the file is not there; remove the row.`,
      )
      continue
    }
    const gone = reader.touches.filter((id) => !found.includes(id))
    if (gone.length > 0)
      problems.push(
        `${reader.file} no longer touches ${gone.join(', ')}, which ${DECLARATION_FILE} still lists for it; narrow or remove the row so the declaration does not claim more than the source does.`,
      )
  }
  return problems
}

/**
 * The files that touch an address (F43-AC2, AC4, AC5). `touches` maps every
 * source file to what the scan found in it, `readers` is ADDRESS_READERS.
 */
export const readerProblems = (data) => [
  ...undeclaredProblems(data),
  ...staleProblems(data),
]

/** The problems of one host's GET routes. */
function hostRouteProblems(host, answered, samples, listed) {
  const problems = []
  const declared = listed.map((where) => where.route)
  for (const route of uncovered(
    answered.filter((route) => !declared.includes(route)),
    samples,
  ))
    problems.push(
      `GET ${route} on the ${host} host is not opened by the test that looks for addresses, and ${DECLARATION_FILE} does not list it as a place an address may show. Add a path it answers to src/site/test-no-email-pages.ts, or list the route as a place with its reason.`,
    )
  for (const route of declared.filter((route) => !answered.includes(route)))
    problems.push(
      `${DECLARATION_FILE} lists GET ${route} on the ${host} host as a place an address may show, and no such route is answered; fix or remove it.`,
    )
  for (const route of declared)
    for (const sample of samples)
      if (routePattern(route).test(sample.replace(/[?#].*$/, '')))
        problems.push(
          `${sample} is opened as a page with no address, and GET ${route} is a place ${DECLARATION_FILE} lets show one; take it out of the list that is checked clean.`,
        )
  return problems
}

/**
 * The GET routes (F43-AC9). `routes` are `{ host, route }` of what each app
 * answers to a GET; `samples` are the paths the leak test opens, by host;
 * `exposures` is ADDRESS_EXPOSURES.
 */
export function routeProblems({ routes, samples, exposures }) {
  const shown = exposures
    .map((exposure) => exposure.where)
    .filter((where) => where.kind === 'page' && where.method === 'GET')
  return ['site', 'operator'].flatMap((host) =>
    hostRouteProblems(
      host,
      routes.filter((r) => r.host === host).map((r) => r.route),
      samples[host],
      shown.filter((where) => where.host === host),
    ),
  )
}
