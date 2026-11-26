// What `scripts/db-export-without-email.mjs` does, decided from data: which
// tables it leaves out, what its arguments mean, where it may write, and
// whether what it wrote still holds one of the left-out tables (F43-AC14).
// Pure: no file system, no processes.
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * The tables to leave out of a copy: every table that has a column holding a
 * subscriber's address, as the declaration lists them. Sorted, once each.
 */
export const tablesToLeave = (columns) =>
  [
    ...new Set(
      columns
        .filter((column) => column.kind === 'subscriber')
        .map((column) => column.table),
    ),
  ].toSorted()

/** The tables of a database that a copy takes: all but the ones to leave. */
export const tablesToTake = (tables, columns) => {
  const leave = new Set(tablesToLeave(columns))
  return tables.filter((table) => !leave.has(table)).toSorted()
}

const USAGE =
  'Usage: node scripts/db-export-without-email.mjs --output <file.sql> [--database <name>]\n       node scripts/db-export-without-email.mjs --list [--database <name>]'

const isRemote = (argument) =>
  argument === '--remote' || argument.startsWith('--remote=')

/**
 * Reads the argument at `index` into `found`. Returns how many arguments it
 * took, or a message when it is not one this script knows.
 */
function take(argv, index, found) {
  const argument = argv[index]
  if (argument === '--list') {
    found.list = true
    return 1
  }
  if (argument !== '--output' && argument !== '--database')
    return `Unknown argument ${JSON.stringify(argument)}. ${USAGE}`
  const value = argv[index + 1]
  if (value === undefined || value === '' || value.startsWith('--'))
    return `${argument} needs a value. ${USAGE}`
  found[argument === '--output' ? 'output' : 'database'] = value
  return 2
}

/**
 * The meaning of the arguments. There is no way to name a remote database: the
 * script reads the local one only, and `--remote` is refused by name so that
 * the refusal says why.
 */
export function parseArgs(argv) {
  if (argv.some(isRemote))
    return {
      kind: 'error',
      message: `--remote is not accepted: this script reads the local database only, so that no copy of production is made with the tables that hold addresses. See docs/dev/deploy.md. ${USAGE}`,
    }
  const found = { database: 'slide', output: null, list: false }
  for (let index = 0; index < argv.length;) {
    const taken = take(argv, index, found)
    if (typeof taken === 'string') return { kind: 'error', message: taken }
    index += taken
  }
  if (found.list && found.output !== null)
    return {
      kind: 'error',
      message: `--list and --output cannot be given together. ${USAGE}`,
    }
  if (found.list) return { kind: 'list', database: found.database }
  if (found.output === null)
    return { kind: 'error', message: `--output is needed. ${USAGE}` }
  return { kind: 'export', database: found.database, output: found.output }
}

/**
 * Whether a copy may be written there: outside the repository, or under its
 * ignored `.wrangler` folder, so that no copy is committed by mistake.
 */
export function mayWriteTo(root, output) {
  const inside = relative(resolve(root), resolve(root, output))
  if (inside.startsWith('..') || isAbsolute(inside)) return true
  return inside === '.wrangler' || inside.startsWith(`.wrangler/`)
}

const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The tables to leave that the SQL of a copy still creates, fills or indexes. */
export function leftOver(sql, leave) {
  return leave.filter((table) =>
    new RegExp(
      `\\b(?:INSERT\\s+INTO|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ON)\\s+["'\`\\[]?${escape(table)}["'\`\\]]?[\\s(]`,
      'i',
    ).test(sql),
  )
}
