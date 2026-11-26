// Writes the local D1 out as SQL without the tables that hold a subscriber's
// email address (F43-AC14). The tables are the ones the declaration in
// src/privacy/email-exposure.ts says hold one, so a table added there is left
// out of the copy as well. It reads the local database only (miniflare's, the
// one `wrangler dev` uses) and never the remote one; it makes no network call.
// See docs/dev/deploy.md, "本番のデータを手元に写すときの決まり".
//
//   node scripts/db-export-without-email.mjs --output <file.sql> [--database slide]
//   node scripts/db-export-without-email.mjs --list [--database slide]
//
// `--list` prints the tables a copy takes, one a line, from the local schema:
// the list to give `wrangler d1 export --remote --table ...`, which the
// operator runs by hand when a copy of production is needed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADDRESS_COLUMNS } from '../src/privacy/email-exposure.ts'
import {
  leftOver,
  mayWriteTo,
  parseArgs,
  tablesToLeave,
  tablesToTake,
} from './db-export-plan.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler')

/** Runs wrangler here, against the local database, and returns what it printed. */
const wrangler = (args) =>
  execFileSync(WRANGLER, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // Nothing is sent: no metrics, and no command here names a remote.
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 512 * 1024 * 1024,
  })

/** The tables of the local database, from sqlite itself. */
function localTables(database) {
  const printed = wrangler([
    'd1',
    'execute',
    database,
    '--local',
    '--json',
    '--command',
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ])
  return JSON.parse(printed)[0].results.map((row) => row.name)
}

function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.kind === 'error') {
    console.error(parsed.message)
    return 2
  }
  if (parsed.kind === 'export' && !mayWriteTo(ROOT, resolve(parsed.output))) {
    console.error(
      `Not writing to ${parsed.output}: it is inside the repository, where a copy could be committed. Write it outside, or under .wrangler/.`,
    )
    return 2
  }
  const tables = tablesToTake(localTables(parsed.database), ADDRESS_COLUMNS)
  if (parsed.kind === 'list') {
    console.log(tables.join('\n'))
    return 0
  }
  wrangler([
    'd1',
    'export',
    parsed.database,
    '--local',
    '--output',
    parsed.output,
    // The last option: it takes every name after it.
    '--table',
    ...tables,
  ])
  // The copy is looked at once more: a table to leave out that is in it
  // (wrangler changing what `--table` means, say) is a copy not to keep.
  const found = leftOver(
    readFileSync(parsed.output, 'utf8'),
    tablesToLeave(ADDRESS_COLUMNS),
  )
  if (found.length > 0) {
    rmSync(parsed.output)
    console.error(
      `The copy held ${found.join(', ')}, which hold email addresses; it was deleted.`,
    )
    return 1
  }
  console.log(
    `Wrote ${parsed.output} without ${tablesToLeave(ADDRESS_COLUMNS).join(', ')}.`,
  )
  return existsSync(parsed.output) ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
