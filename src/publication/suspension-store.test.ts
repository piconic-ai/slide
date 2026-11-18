import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import {
  applySuspensionCommand,
  readSuspension,
  saveSuspension,
} from './suspension-store'
import { OWNER_ID, resetTables } from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

const suspend = (reason: string, now: number) =>
  applySuspensionCommand(db, {
    userId: OWNER_ID,
    command: { kind: 'suspend', reason, operator: 'op@example.com' },
    now,
  })
const release = () =>
  applySuspensionCommand(db, {
    userId: OWNER_ID,
    command: { kind: 'release' },
    now: 200,
  })

test('F17-AC28: Given a release decided against one suspension, When it is saved after another release and a new suspension, Then the new suspension stays', async () => {
  await suspend('first', 100)
  const first = await readSuspension(db, OWNER_ID)
  if (!first) throw new Error('not suspended')
  await release()
  await suspend('newly discovered phishing', 300)

  expect(
    await saveSuspension(db, { userId: OWNER_ID, from: first, next: null }),
  ).toBe(false)
  expect(await readSuspension(db, OWNER_ID)).toEqual({
    suspendedAt: 300,
    reason: 'newly discovered phishing',
    operator: 'op@example.com',
  })
})

test('F17-AC27: Given a suspension decided for an account not suspended, When another suspension is stored first, Then the later save does not replace it', async () => {
  await suspend('first', 100)

  expect(
    await saveSuspension(db, {
      userId: OWNER_ID,
      from: null,
      next: {
        suspendedAt: 300,
        reason: 'second',
        operator: 'other@example.com',
      },
    }),
  ).toBe(false)
  expect(await readSuspension(db, OWNER_ID)).toMatchObject({ reason: 'first' })
})

test('F17-AC28: Given a suspended account, When the release is saved against the stored suspension, Then the row is removed', async () => {
  await suspend('first', 100)
  const first = await readSuspension(db, OWNER_ID)

  expect(
    await saveSuspension(db, { userId: OWNER_ID, from: first, next: null }),
  ).toBe(true)
  expect(await readSuspension(db, OWNER_ID)).toBeNull()
})
