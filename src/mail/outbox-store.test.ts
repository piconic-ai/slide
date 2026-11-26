import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { resetTables } from '../publication/test-support'
import { readOutbox, writeOutbox } from './outbox-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const DAY = 24 * 60 * 60
const mail = { to: 'person@mail.example', subject: 's', text: 'code 123456' }

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

test('Given a mail, When it is written to the box, Then the box holds it under its address, and only that address finds it', async () => {
  await writeOutbox(db, mail, 100)
  expect(
    await orm.all(sql`SELECT to_address, subject, body FROM mail_outbox`),
  ).toEqual([
    { to_address: 'person@mail.example', subject: 's', body: 'code 123456' },
  ])
  expect(await readOutbox(db, 'person@mail.example')).toHaveLength(1)
  expect(await readOutbox(db, 'other@mail.example')).toEqual([])
  expect(await readOutbox(db, '')).toEqual([])
})

test('Given two mails to one address, When the box is read, Then the newer one comes first', async () => {
  await writeOutbox(db, { ...mail, subject: 'first' }, 100)
  await writeOutbox(db, { ...mail, subject: 'second' }, 100)
  expect((await readOutbox(db, mail.to)).map((row) => row.subject)).toEqual([
    'second',
    'first',
  ])
})

test('F43-AC12: Given rows written 24 hours ago exactly and a second earlier, When another mail is written, Then only the older one is dropped', async () => {
  const now = 10 * DAY
  await writeOutbox(db, { ...mail, subject: 'older' }, now - DAY - 1)
  await writeOutbox(db, { ...mail, subject: 'edge' }, now - DAY)
  await writeOutbox(db, { ...mail, subject: 'new' }, now)
  expect((await readOutbox(db, mail.to)).map((row) => row.subject)).toEqual([
    'new',
    'edge',
  ])
})

test('F43-AC12: Given the checked-in Worker configuration, When it is read in full, Then MAIL_OUTBOX is nowhere in it, in the vars or in an environment, so production writes no box row', async () => {
  const text = await readFile('wrangler.jsonc', 'utf8')
  // The name is not in a comment either: nobody is to turn it on there.
  expect(text).not.toContain('MAIL_OUTBOX')
  const json = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  const config = JSON.parse(json) as {
    vars: Record<string, string>
    env?: Record<string, { vars?: Record<string, string> }>
  }
  expect(config.vars).not.toHaveProperty('MAIL_OUTBOX')
  for (const [name, environment] of Object.entries(config.env ?? {}))
    expect(environment.vars ?? {}, name).not.toHaveProperty('MAIL_OUTBOX')
})
