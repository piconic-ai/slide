import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const LAST_OF_SCOPE3 = '0058_community_follows.sql'
const PLACEHOLDER = `enc1:${'a'.repeat(64)}`

beforeAll(async () => {
  await applyMigrations(database, { until: LAST_OF_SCOPE3 })
  await db.run(sql`INSERT INTO auth_user
    (id, name, email, email_verified, created_at, updated_at)
    VALUES ('u-alice', '', 'alice@mail.example', 1, 1, 1)`)
  await db.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by)
    VALUES ('alice@mail.example', 1, 'op@example.com')`)
  await applyMigrations(database, { after: LAST_OF_SCOPE3 })
})
afterAll(() => platform.dispose())

test('F41-AC19: Given the migrations of the email encryption, When their statements are read, Then none drops, renames, rebuilds or deletes', () => {
  for (const name of [
    '0059_email_ciphertext.sql',
    '0060_email_plain_index.sql',
  ]) {
    const code = readFileSync(`migrations/${name}`, 'utf8').replace(
      /--.*$/gm,
      '',
    )
    expect(code, name).not.toMatch(
      /\b(DROP|RENAME|DELETE|TRUNCATE|REPLACE|UPDATE)\b/i,
    )
  }
})

test('F41-AC19, F41-AC6: Given plain rows from before, When the migrations are added, Then the rows stay plain, readable and without a sealed text', async () => {
  expect(
    await db.all(sql`SELECT id, email, email_ciphertext AS c FROM auth_user`),
  ).toEqual([{ id: 'u-alice', email: 'alice@mail.example', c: null }])
  expect(
    await db.all(sql`SELECT email, email_ciphertext AS c FROM invited_emails`),
  ).toEqual([{ email: 'alice@mail.example', c: null }])
})

test.each(['auth_user', 'invited_emails'])(
  'F41-AC8: Given the plain rows of %s, When the index of them is asked, Then it finds them and no sealed row',
  async (table) => {
    const plain = await db.all(
      sql.raw(
        `SELECT count(*) AS n FROM ${table} WHERE email_ciphertext IS NULL`,
      ),
    )
    expect(plain).toEqual([{ n: 1 }])
    const plan = await db.all(
      sql.raw(
        `EXPLAIN QUERY PLAN SELECT count(*) FROM ${table} WHERE email_ciphertext IS NULL`,
      ),
    )
    expect(JSON.stringify(plan)).toContain('_plain_email')
  },
)

test('F41-AC3: Given a sealed row and another with the same lookup value, When both are written, Then the second is refused', async () => {
  const user = (id: string, email: string, sealed: string | null) =>
    db.run(sql`INSERT INTO auth_user
      (id, name, email, email_verified, created_at, updated_at, email_ciphertext)
      VALUES (${id}, '', ${email}, 1, 1, 1, ${sealed})`)
  await user('u-sealed', PLACEHOLDER, 'sealed-text')
  await expect(user('u-twin', PLACEHOLDER, 'other-text')).rejects.toThrow()
})

test('Given the CHECK of the new column, When a row says one thing in the address and another in the sealed text, Then it is refused', async () => {
  const user = (email: string, sealed: string | null) =>
    db.run(sql`INSERT INTO auth_user
      (id, name, email, email_verified, created_at, updated_at, email_ciphertext)
      VALUES (${email}, '', ${email}, 1, 1, 1, ${sealed})`)
  await expect(user('bob@mail.example', 'sealed-text')).rejects.toThrow()
  await expect(user(`enc1:${'b'.repeat(64)}`, null)).rejects.toThrow()
  const invite = (email: string, sealed: string | null) =>
    db.run(sql`INSERT INTO invited_emails
      (email, invited_at, invited_by, email_ciphertext)
      VALUES (${email}, 1, 'op@example.com', ${sealed})`)
  await expect(invite('bob@mail.example', 'sealed-text')).rejects.toThrow()
  await expect(invite(`enc1:${'b'.repeat(64)}`, null)).rejects.toThrow()
  await invite(`enc1:${'c'.repeat(64)}`, 'sealed-text')
})
