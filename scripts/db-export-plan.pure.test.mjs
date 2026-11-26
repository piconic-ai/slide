import { describe, expect, it } from 'vitest'
import { ADDRESS_COLUMNS } from '../src/privacy/email-exposure'
import {
  leftOver,
  mayWriteTo,
  parseArgs,
  tablesToLeave,
  tablesToTake,
} from './db-export-plan.mjs'

const columns = [
  { table: 'users', column: 'email', kind: 'subscriber' },
  { table: 'users', column: 'email_verified', kind: 'not-an-address' },
  { table: 'invites', column: 'email', kind: 'subscriber' },
  { table: 'decks', column: 'hidden_by', kind: 'operator' },
  { table: 'requests', column: 'address_hash', kind: 'keyed-hash' },
]

describe('F43-AC14: the tables a copy leaves out', () => {
  it('Given the columns, Then the left-out tables are those with a subscriber column, once each and sorted', () => {
    expect(tablesToLeave(columns)).toEqual(['invites', 'users'])
  })

  it('Given a table with only operator, keyed-hash and non-address columns, Then it is taken', () => {
    expect(
      tablesToTake(
        ['users', 'decks', 'requests', 'invites', 'accounts'],
        columns,
      ),
    ).toEqual(['accounts', 'decks', 'requests'])
  })

  it('Given a subscriber column added to a table, Then the table is left out too', () => {
    const added = [
      ...columns,
      { table: 'decks', column: 'contact_email', kind: 'subscriber' },
    ]
    expect(tablesToTake(['decks', 'accounts'], added)).toEqual(['accounts'])
  })

  it('Given no columns and no tables, Then nothing is left out and nothing is taken', () => {
    expect(tablesToLeave([])).toEqual([])
    expect(tablesToTake([], [])).toEqual([])
  })

  it('Given the real declaration, Then the three tables of the spec and the sign-in codes are left out', () => {
    expect(tablesToLeave(ADDRESS_COLUMNS)).toEqual([
      'auth_user',
      'auth_verification',
      'invited_emails',
      'mail_outbox',
    ])
  })
})

describe('F43-AC14: parseArgs', () => {
  it('Given an output, Then it is an export of the default local database', () => {
    expect(parseArgs(['--output', 'copy.sql'])).toEqual({
      kind: 'export',
      database: 'slide',
      output: 'copy.sql',
    })
  })

  it('Given a database name, Then it is used', () => {
    expect(parseArgs(['--database', 'other', '--output', 'c.sql'])).toEqual({
      kind: 'export',
      database: 'other',
      output: 'c.sql',
    })
  })

  it('Given --list, Then it lists', () => {
    expect(parseArgs(['--list'])).toEqual({ kind: 'list', database: 'slide' })
  })

  it.each([
    ['--remote', ['--remote', '--output', 'c.sql']],
    ['--remote after', ['--output', 'c.sql', '--remote']],
    ['--remote=true', ['--output', 'c.sql', '--remote=true']],
    ['--remote with --list', ['--list', '--remote']],
  ])('Given %s, Then it is refused by name', (_label, argv) => {
    const parsed = parseArgs(argv)
    expect(parsed.kind).toBe('error')
    expect(parsed.message).toContain('--remote is not accepted')
  })

  it.each([
    ['nothing', []],
    ['no output', ['--database', 'slide']],
    ['an output without a value', ['--output']],
    ['an output that is an option', ['--output', '--list']],
    ['an empty output', ['--output', '']],
    ['an unknown option', ['--output', 'c.sql', '--env', 'production']],
    ['a loose word', ['copy.sql']],
    ['--list with --output', ['--list', '--output', 'c.sql']],
  ])('Given %s, Then it is an error with the usage', (_label, argv) => {
    const parsed = parseArgs(argv)
    expect(parsed.kind).toBe('error')
    expect(parsed.message).toContain('Usage')
  })
})

describe('F43-AC14: mayWriteTo', () => {
  it.each([
    ['/repo', '/home/me/copies/c.sql', true],
    ['/repo', '/repo/.wrangler/copies/c.sql', true],
    ['/repo', '/repo/c.sql', false],
    ['/repo', '/repo/docs/c.sql', false],
    ['/repo', '/repo/.wrangler-other/c.sql', false],
    ['/repo', '/repository/c.sql', true],
    ['/repo', '/repo/../elsewhere/c.sql', true],
    ['/repo', '/repo', false],
  ])(
    'Given the repository %s and the output %s, Then it is %s',
    (root, output, ok) => {
      expect(mayWriteTo(root, output)).toBe(ok)
    },
  )
})

describe('F43-AC14: leftOver', () => {
  const leave = ['users', 'invites']
  it('Given a copy of other tables, Then nothing is left over', () => {
    expect(
      leftOver(
        'CREATE TABLE "accounts" (id);\nINSERT INTO "accounts" VALUES (1);\nCREATE INDEX x ON accounts(id);',
        leave,
      ),
    ).toEqual([])
  })

  it.each([
    ['a table', 'CREATE TABLE "users" (id);'],
    ['a table unquoted', 'CREATE TABLE users (id);'],
    ['a table if not exists', 'CREATE TABLE IF NOT EXISTS `users` (id);'],
    ['rows', 'INSERT INTO "users" VALUES (1);'],
    ['an index', 'CREATE INDEX i ON "users"(id);'],
    ['lower case', 'insert into users values (1);'],
  ])(
    'Given a copy with %s of a left-out table, Then it is named',
    (_label, sql) => {
      expect(leftOver(sql, leave)).toEqual(['users'])
    },
  )

  it('Given a table whose name only starts like a left-out one, Then it is not one', () => {
    expect(leftOver('INSERT INTO "users_old" VALUES (1);', leave)).toEqual([])
  })

  it('Given a row whose text reads like an insert into a left-out table, Then it errs towards the copy being thrown away', () => {
    expect(
      leftOver(`INSERT INTO "notes" VALUES ('INSERT INTO users (id)');`, leave),
    ).toEqual(['users'])
  })
})
