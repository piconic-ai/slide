import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { addInvite, isInvitedUser } from '../auth/invites-store'
import { emailOf, resetTables, seedPerson } from '../publication/test-support'
import type { EmailAddress } from '../mail/address'
import {
  columnsFor,
  EMAIL_CRYPTO_OFF,
  placeholderOf,
  lookupOf,
} from './email-cipher'
import { emailCryptoOf } from './email-settings'
import { isDone } from './email-rewrite'
import { countEmailRows, rewriteEmails } from './email-rewrite-store'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)

const b64 = (seed: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const keys = (settings: Record<string, string> = {}) =>
  emailCryptoOf({
    EMAIL_CIPHER_KEYS: `1:${b64(1)}`,
    EMAIL_CIPHER_CURRENT: '1',
    EMAIL_LOOKUP_KEY: b64(9),
    ...settings,
  })
const crypto = keys()
const on = crypto as Extract<typeof crypto, { kind: 'on' }>

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

/** People as they were before the keys: a plain user and a plain invitation. */
const legacy = async (...logins: string[]) => {
  for (const login of logins) await seedPerson(db, `u-${login}`, login)
}
/**
 * A plain person written straight into the tables, as a row left from before
 * the keys would be: `addInvite` refuses to add one beside sealed rows.
 */
const plainAfterwards = async (login: string) => {
  const email = emailOf(login)
  await orm.run(sql`INSERT INTO auth_user
    (id, name, email, email_verified, created_at, updated_at)
    VALUES (${`u-${login}`}, '', ${email}, 1, 1, 1)`)
  await orm.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by)
    VALUES (${email}, 1, 'op@example.com')`)
}
const sealedInvite = (login: string) =>
  addInvite(
    db,
    {
      email: emailOf(login) as EmailAddress,
      invitedBy: 'op@example.com',
      now: 1,
    },
    crypto,
  )
const everyone = async (logins: string[]) =>
  Promise.all(logins.map((login) => isInvitedUser(db, `u-${login}`)))
const text = async () =>
  JSON.stringify([
    await orm.all(sql`SELECT * FROM auth_user`),
    await orm.all(sql`SELECT * FROM invited_emails`),
  ]).toLowerCase()

test('F41-AC8: Given only plain rows, When the operator rewrites, Then the plain count falls to 0, nobody loses their invitation and no address is left', async () => {
  await legacy('a', 'b', 'c')
  expect(await countEmailRows(db, on)).toEqual({
    plain: 6,
    olderVersion: 0,
    current: 0,
  })
  const result = await rewriteEmails(db, crypto)
  expect(result).toMatchObject({ sealed: 3, resealed: 0, failed: 0 })
  expect(result.remaining).toEqual({ plain: 0, olderVersion: 0, current: 6 })
  expect(isDone(result.remaining)).toBe(true)
  expect(await everyone(['a', 'b', 'c'])).toEqual([true, true, true])
  expect(await text()).not.toContain('mail.example')
})

test('F41-AC9: Given a limit smaller than the work, When the operator rewrites again and again, Then each press goes on from the rest and a press after the end changes nothing', async () => {
  await legacy('a', 'b', 'c', 'd', 'e')
  const first = await rewriteEmails(db, crypto, 2)
  expect(first.sealed).toBe(2)
  expect(first.remaining.plain).toBe(6)
  // Midway the plain and the sealed are mixed, and everyone is still invited.
  expect(await everyone(['a', 'b', 'c', 'd', 'e'])).toEqual(Array(5).fill(true))
  await rewriteEmails(db, crypto, 2)
  const last = await rewriteEmails(db, crypto, 2)
  expect(last.remaining.plain).toBe(0)
  const before = await text()
  const again = await rewriteEmails(db, crypto, 2)
  expect(again).toMatchObject({ sealed: 0, resealed: 0, failed: 0 })
  expect(await text()).toBe(before)
})

test('F41-AC7, F41-AC8: Given sealed and plain rows mixed, When the operator rewrites, Then only the plain ones change and the sealed ones are not touched', async () => {
  await legacy('plain')
  await sealedInvite('sealed')
  const sealedBefore = await orm.all(
    sql`SELECT * FROM invited_emails WHERE email_ciphertext IS NOT NULL`,
  )
  await rewriteEmails(db, crypto)
  expect(
    await orm.all(
      sql`SELECT * FROM invited_emails WHERE email_ciphertext IS NOT NULL AND email = ${placeholderOf(await lookupOf(crypto, emailOf('sealed')))}`,
    ),
  ).toEqual(sealedBefore)
  expect((await countEmailRows(db, on)).plain).toBe(0)
})

test('F41-AC8: Given only sealed rows, When the operator rewrites, Then nothing changes', async () => {
  await sealedInvite('a')
  const before = await text()
  expect(await rewriteEmails(db, crypto)).toMatchObject({
    sealed: 0,
    resealed: 0,
    failed: 0,
  })
  expect(await text()).toBe(before)
})

test('F41-AC9: Given one address that cannot be rewritten, When the operator rewrites, Then that row stays plain, the rest are sealed and the next press tries it again', async () => {
  await legacy('ok', 'stuck')
  // A sealed invitation already holds the lookup value of the plain one's address.
  const held = await columnsFor(crypto, emailOf('stuck'), new Uint8Array(12))
  await orm.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by, email_ciphertext)
    VALUES (${held.email}, 1, 'x', ${held.emailCiphertext})`)
  const result = await rewriteEmails(db, crypto)
  expect(result.failed).toBe(1)
  expect(result.sealed).toBe(1)
  expect(
    await orm.all(
      sql`SELECT email FROM auth_user WHERE email_ciphertext IS NULL`,
    ),
  ).toEqual([{ email: emailOf('stuck') }])
  expect(await isInvitedUser(db, 'u-stuck')).toBe(true)
  expect((await rewriteEmails(db, crypto)).failed).toBe(1)
})

test('F41-AC11, F41-AC12: Given rows sealed under version 1, When version 2 is added and made current, Then they still open and a rewrite seals them under version 2', async () => {
  await legacy('a', 'b')
  await rewriteEmails(db, crypto)
  const rotated = keys({
    EMAIL_CIPHER_KEYS: `1:${b64(1)},2:${b64(2)}`,
    EMAIL_CIPHER_CURRENT: '2',
  })
  const rotatedOn = rotated as Extract<typeof rotated, { kind: 'on' }>
  expect(await everyone(['a', 'b'])).toEqual([true, true])
  expect(await countEmailRows(db, rotatedOn)).toEqual({
    plain: 0,
    olderVersion: 4,
    current: 0,
  })
  const result = await rewriteEmails(db, rotated)
  expect(result).toMatchObject({ sealed: 0, resealed: 4, failed: 0 })
  expect(result.remaining).toEqual({ plain: 0, olderVersion: 0, current: 4 })
  const kept = await orm.all<{ c: string }>(
    sql`SELECT email_ciphertext AS c FROM auth_user`,
  )
  expect(kept.every((row) => row.c.startsWith('ec1.2.'))).toBe(true)
  // Version 1 can now be taken away.
  const only2 = keys({
    EMAIL_CIPHER_KEYS: `2:${b64(2)}`,
    EMAIL_CIPHER_CURRENT: '2',
  })
  expect((await rewriteEmails(db, only2)).failed).toBe(0)
})

test('F41-AC14: Given a wrong key, When the operator rewrites, Then it refuses before touching any row', async () => {
  await legacy('a')
  await rewriteEmails(db, crypto)
  await plainAfterwards('b')
  const before = await text()
  await expect(
    rewriteEmails(db, keys({ EMAIL_CIPHER_KEYS: `1:${b64(2)}` })),
  ).rejects.toThrow('email crypto')
  await expect(
    rewriteEmails(db, keys({ EMAIL_LOOKUP_KEY: b64(8) })),
  ).rejects.toThrow('email crypto')
  expect(await text()).toBe(before)
})

test('F41-AC13: Given the keys are off or unusable, When the operator rewrites, Then it refuses', async () => {
  await legacy('a')
  await expect(rewriteEmails(db, EMAIL_CRYPTO_OFF)).rejects.toThrow(
    'not_usable',
  )
  await expect(
    rewriteEmails(db, keys({ EMAIL_CIPHER_CURRENT: '9' })),
  ).rejects.toThrow('not_usable')
  expect((await orm.all(sql`SELECT email FROM auth_user`))[0]).toEqual({
    email: emailOf('a'),
  })
})

test('F41-AC9: Given a user with no invitation and an invitation with no user, When the operator rewrites, Then both are sealed', async () => {
  await legacy('both')
  await orm.run(
    sql`DELETE FROM invited_emails WHERE email = ${emailOf('both')}`,
  )
  await orm.run(
    sql`INSERT INTO invited_emails (email, invited_at, invited_by) VALUES ('lonely@mail.example', 1, 'x')`,
  )
  await rewriteEmails(db, crypto)
  expect((await countEmailRows(db, on)).plain).toBe(0)
})

test('F41-AC9: Given two presses at once, When both finish, Then each address is sealed once and nothing is lost', async () => {
  await legacy('a', 'b', 'c')
  await Promise.all([rewriteEmails(db, crypto), rewriteEmails(db, crypto)])
  expect((await countEmailRows(db, on)).plain).toBe(0)
  expect(await everyone(['a', 'b', 'c'])).toEqual([true, true, true])
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toHaveLength(3)
})

test('F41-AC9: Given rows that keep failing and a limit that they alone could fill, When the operator presses again and again, Then the rows that can be sealed are sealed all the same', async () => {
  await legacy('ok1', 'ok2', 'ok3', 'stuck1')
  const held = await columnsFor(crypto, emailOf('stuck1'), new Uint8Array(12))
  await orm.run(sql`INSERT INTO invited_emails (email, invited_at, invited_by, email_ciphertext)
    VALUES (${held.email}, 1, 'x', ${held.emailCiphertext})`)
  for (let press = 0; press < 6; press += 1) await rewriteEmails(db, crypto, 2)
  expect(
    await orm.all(
      sql`SELECT email FROM auth_user WHERE email_ciphertext IS NULL`,
    ),
  ).toEqual([{ email: emailOf('stuck1') }])
})
