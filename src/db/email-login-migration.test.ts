import { getTableColumns, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  invitedEmails,
  loginCodeRequests,
  mailOutbox,
  notifications,
  profiles,
} from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)

beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

test('F28-AC32: Given an empty D1, When every migration is applied, Then no table, column, index or constraint (their stored definitions) names GitHub', async () => {
  const definitions = await db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master`,
  )
  expect(definitions.length).toBeGreaterThan(10)
  for (const { name, sql: text } of definitions) {
    expect(name.toLowerCase(), name).not.toContain('github')
    expect((text ?? '').toLowerCase(), name).not.toContain('github')
  }
})

test('F28-AC32: Given the migrated schema, When the user-keyed tables are read, Then none keeps a login, an avatar address or a Sponsors flag from GitHub', async () => {
  const names = async (table: string) =>
    (
      await db.all<{ name: string }>(
        sql.raw(`SELECT name FROM pragma_table_info('${table}')`),
      )
    ).map((row) => row.name)
  expect((await names('profiles')).sort()).toEqual(
    [
      'bio',
      'gravatar_at',
      'location',
      'name',
      'use_gravatar',
      'user_id',
      'website',
    ].sort(),
  )
})

test.each([
  ['invited_emails', invitedEmails],
  ['mail_outbox', mailOutbox],
  ['login_code_requests', loginCodeRequests],
  ['profiles', profiles],
  ['notifications', notifications],
] as const)(
  'Given the migrated %s table, When its columns are read, Then they match the Drizzle table',
  async (name, table) => {
    const stored = await db.all<{ name: string; type: string }>(
      sql.raw(`SELECT name, type FROM pragma_table_info('${name}')`),
    )
    const declared = Object.values(getTableColumns(table)).map((column) => ({
      name: column.name,
      type: column.getSQLType().toUpperCase(),
    }))
    expect(stored).toMatchObject(declared)
  },
)

test('F28-AC28: Given the migrated notifications table, When a GitHub join notification is inserted, Then the shape constraint refuses it', async () => {
  await expect(
    db.run(sql`INSERT INTO notifications
      (id, recipient_user_id, kind, actor_user_id, created_at)
      VALUES ('x', 'a', 'github_followee_joined', 'b', 1)`),
  ).rejects.toThrow()
  await db.run(sql`INSERT INTO notifications
    (id, recipient_user_id, kind, actor_user_id, created_at)
    VALUES ('y', 'a', 'followed', 'b', 1)`)
})

test.each(['', 'A@B.EXAMPLE', 'a'])(
  'Given the address %j, When it is invited, Then only a lowercase address of a plausible length is kept',
  async (email) => {
    await expect(
      db.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by)
        VALUES (${email}, 1, 'op')`),
    ).rejects.toThrow()
  },
)

test('Given an address invited twice, When it is inserted again, Then the table refuses the repeat', async () => {
  const insert = () =>
    db.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by)
      VALUES ('dup@example.com', 1, 'op')`)
  await insert()
  await expect(insert()).rejects.toThrow()
})
