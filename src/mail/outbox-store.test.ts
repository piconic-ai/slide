import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { EMAIL_CRYPTO_OFF } from '../db/email-cipher'
import { emailCryptoOf } from '../db/email-settings'
import { applyMigrations } from '../db/test-migrations'
import { resetTables } from '../publication/test-support'
import { readOutbox, writeOutbox } from './outbox-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const b64 = (seed: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const crypto = emailCryptoOf({
  EMAIL_CIPHER_KEYS: `1:${b64(1)}`,
  EMAIL_CIPHER_CURRENT: '1',
  EMAIL_LOOKUP_KEY: b64(9),
})
const mail = { to: 'Person@Mail.example', subject: 's', text: 'code 123456' }

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

test('F41-AC1: Given the keys on, When a mail is written to the box, Then the box holds the lookup value, and the address finds it under the same keys', async () => {
  await writeOutbox(db, mail, 100, crypto)
  const [row] = await orm.all<{ to_address: string }>(
    sql`SELECT to_address FROM mail_outbox`,
  )
  expect(row?.to_address).toMatch(/^enc1:[0-9a-f]{64}$/)
  expect(await readOutbox(db, 'person@mail.example', crypto)).toHaveLength(1)
  expect(await readOutbox(db, 'other@mail.example', crypto)).toEqual([])
})

test('F41-AC13: Given the keys off, When a mail is written to the box, Then the box holds the address as before', async () => {
  await writeOutbox(db, mail, 100, EMAIL_CRYPTO_OFF)
  expect(await orm.all(sql`SELECT to_address FROM mail_outbox`)).toEqual([
    { to_address: 'person@mail.example' },
  ])
  expect(await readOutbox(db, 'Person@mail.example')).toHaveLength(1)
})

test('F41-AC1: Given the checked-in Worker configuration, When its vars are read, Then the outbox is not on and no key is a var, so production writes no box row and holds its keys as secrets', async () => {
  const text = await readFile('wrangler.jsonc', 'utf8')
  const json = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  const { vars } = JSON.parse(json) as { vars: Record<string, string> }
  for (const name of [
    'MAIL_OUTBOX',
    'EMAIL_CIPHER_KEYS',
    'EMAIL_CIPHER_CURRENT',
    'EMAIL_LOOKUP_KEY',
  ])
    expect(vars, name).not.toHaveProperty(name)
})
