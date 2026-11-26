#!/usr/bin/env node
// Writes signed-in authors into a local Worker's D1 and prints their cookies
// as a JSON list, the file the upload script reads with --cookies. Local
// only: it runs `wrangler d1 execute --local` against a state directory.
//
//   node scripts/load/make-local-authors.mjs STATE_DIRECTORY COUNT > cookies.json
//
// BETTER_AUTH_SECRET names the Worker's secret; the default is the one
// .agents/skills/verify-slide/launch.sh starts a Worker with.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localAuthors } from './local-authors.mjs'

const [state, countText] = process.argv.slice(2)
if (!state || !countText)
  throw new Error(
    'Usage: node scripts/load/make-local-authors.mjs STATE_DIRECTORY COUNT',
  )
const secret =
  process.env.BETTER_AUTH_SECRET ?? 'local-demo-only-better-auth-secret-000000'
const { sql, cookies } = localAuthors({
  count: Number(countText),
  secret,
  now: Date.now(),
  token: () => randomUUID().replaceAll('-', ''),
})
const directory = await mkdtemp(join(tmpdir(), 'load-authors-'))
const file = join(directory, 'authors.sql')
await writeFile(file, sql)
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'slide',
    '--local',
    '--file',
    file,
    '--persist-to',
    state,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
console.log(JSON.stringify(cookies))
