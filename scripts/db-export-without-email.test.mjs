import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADDRESS_COLUMNS } from '../src/privacy/email-exposure'

// These run scripts/db-export-without-email.mjs as a real process, against a
// local D1 that this test makes in a folder of its own (wrangler's local
// state, miniflare's). No command here names a remote database, and the
// script refuses to; nothing is sent anywhere.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/db-export-without-email.mjs')
const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler')
const ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

let dir

const run = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: dir, env: ENV, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    )
  })
const wrangler = (...args) => run(WRANGLER, args)
const script = (...args) => run(process.execPath, [SCRIPT, ...args])

const ADDRESSES = [
  'person-one@mail.example',
  'person-two@mail.example',
  'invited@mail.example',
  'outbox@mail.example',
]

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slide-export-'))
  await writeFile(
    join(dir, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'export-test',
      compatibility_date: '2026-01-01',
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'slide',
          database_id: '00000000-0000-0000-0000-000000000000',
          migrations_dir: join(ROOT, 'migrations'),
        },
      ],
    }),
  )
  const migrated = await wrangler(
    'd1',
    'migrations',
    'apply',
    'slide',
    '--local',
  )
  expect(migrated.code, migrated.stderr).toBe(0)
  const seeded = await wrangler(
    'd1',
    'execute',
    'slide',
    '--local',
    '--command',
    [
      `INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', '', '${ADDRESSES[0]}', 1, 1, 1), ('u2', '', '${ADDRESSES[1]}', 1, 1, 1)`,
      `INSERT INTO invited_emails (email, invited_at, invited_by) VALUES ('${ADDRESSES[2]}', 1, 'op@operator.example')`,
      `INSERT INTO mail_outbox (id, to_address, subject, body, created_at) VALUES ('m1', '${ADDRESSES[3]}', 'code', '123456', 1)`,
      `INSERT INTO auth_verification (id, identifier, value, expires_at, created_at, updated_at) VALUES ('v1', 'sign-in-otp-${ADDRESSES[0]}', 'x', 1, 1, 1)`,
      `INSERT INTO accounts (user_id, handle, created_at) VALUES ('u1', 'one', 1), ('u2', 'two', 1)`,
      `INSERT INTO login_code_requests (id, kind, address_hash, source_hash, requested_at) VALUES ('r1', 'send', 'hash', 'source', 1)`,
    ].join('; '),
  )
  expect(seeded.code, seeded.stderr).toBe(0)
}, 120_000)

afterAll(() => rm(dir, { recursive: true, force: true }))

/** The rows of each table of a copy, read by loading it into sqlite. */
function rowsOf(sql) {
  const database = new DatabaseSync(':memory:')
  database.exec(sql)
  const names = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
  return Object.fromEntries(
    names.map((name) => [
      name,
      database.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n,
    ]),
  )
}

describe('F43-AC14: the copy without the tables that hold an address', () => {
  it('F43-AC14: Given a local D1 with rows in every kind of table, When it is copied, Then the tables of the declaration are not in the copy, and the others are, with their rows', async () => {
    const output = join(dir, 'copy.sql')
    const result = await script('--output', output)
    expect(result.code, result.stderr).toBe(0)
    const sql = await readFile(output, 'utf8')
    const rows = rowsOf(sql)
    const left = [
      ...new Set(
        ADDRESS_COLUMNS.filter((c) => c.kind === 'subscriber').map(
          (c) => c.table,
        ),
      ),
    ]
    expect(left).toEqual(
      expect.arrayContaining([
        'auth_user',
        'invited_emails',
        'mail_outbox',
        'auth_verification',
      ]),
    )
    for (const table of left)
      expect(rows[table], `${table} is in the copy`).toBeUndefined()
    expect(rows.accounts).toBe(2)
    expect(rows.login_code_requests).toBe(1)
    expect(Object.keys(rows).length).toBeGreaterThan(30)
    for (const address of ADDRESSES) expect(sql).not.toContain(address)
  }, 120_000)

  it('F43-AC14: Given --list, When it is run, Then it prints the tables a copy takes, none of them one that holds an address', async () => {
    const result = await script('--list')
    expect(result.code, result.stderr).toBe(0)
    const tables = result.stdout.trim().split('\n')
    expect(tables).toContain('accounts')
    for (const table of ['auth_user', 'invited_emails', 'mail_outbox'])
      expect(tables).not.toContain(table)
  }, 60_000)

  it.each([
    ['--remote', ['--remote', '--output', 'remote.sql']],
    ['--remote=true', ['--output', 'remote.sql', '--remote=true']],
  ])(
    'F43-AC14: Given %s, When it is run, Then it refuses, names why, and writes nothing',
    async (_label, args) => {
      const result = await script(...args)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('--remote is not accepted')
      expect(existsSync(join(dir, 'remote.sql'))).toBe(false)
    },
  )

  it('F43-AC14: Given an output inside the repository, When it is run, Then it refuses before reading anything', async () => {
    const result = await script(
      '--output',
      join(ROOT, 'copy-should-not-exist.sql'),
    )
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('inside the repository')
    expect(existsSync(join(ROOT, 'copy-should-not-exist.sql'))).toBe(false)
  })

  it('F43-AC14: Given no arguments, When it is run, Then it prints the usage and exits with an error', async () => {
    const result = await script()
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('Usage')
  })
})
