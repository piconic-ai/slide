import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, repositoryBindings } from '../db/schema'
import { authAccount, authSession, authUser } from '../db/auth-schema'
import { applyMigrations } from '../db/test-migrations'
import { bindingRequestSchema } from './binding'
import { saveBinding } from './store'
import { seedOwnerSession } from '../auth/test-session'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const repository = {
  repositoryId: '1446590227',
  repositoryOwnerId: '248307881',
  fullName: 'piconic-ai/slide',
}

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await orm.batch([
    orm.delete(repositoryBindings),
    orm.delete(decks),
    orm.delete(authSession),
    orm.delete(authAccount),
    orm.delete(authUser),
  ])
})
afterAll(() => platform.dispose())

const save = async (ownerUserId: string, deck: string, deckLimit = 2) =>
  saveBinding(db, {
    ownerUserId,
    sessionId: await seedOwnerSession(db, ownerUserId),
    request: bindingRequestSchema.parse({
      deck,
      repository: 'piconic-ai/slide',
      branches: ['main'],
    }),
    repository,
    deckLimit,
    now: 1,
  })
const deckCount = (owner: string) =>
  orm.$count(decks, eq(decks.owner_user_id, owner))

test('given an account below its deck limit, when it connects a new deck, then the deck is created', async () => {
  expect(await save('alice', 'one')).toBe('saved')
  expect(await save('alice', 'two')).toBe('saved')
  expect(await deckCount('alice')).toBe(2)
})

test('given an account at its deck limit, when it connects a new deck, then nothing is created or bound', async () => {
  await save('alice', 'one')
  await save('alice', 'two')
  expect(await save('alice', 'three')).toBe('deck_limit')
  expect(await deckCount('alice')).toBe(2)
  expect(
    await orm.$count(
      repositoryBindings,
      eq(repositoryBindings.deck_id, 'three'),
    ),
  ).toBe(0)
})

test('given an account at its deck limit, when it reconnects an existing deck, then the binding is replaced', async () => {
  await save('alice', 'one')
  await save('alice', 'two')
  expect(await save('alice', 'one')).toBe('saved')
})

test('given another account at its deck limit, when an account connects a new deck, then it is created', async () => {
  await save('bob', 'one')
  await save('bob', 'two')
  expect(await save('alice', 'three')).toBe('saved')
})

test("given another account's deck of the same slug, when an account at its limit connects it, then it counts as a new deck of its own", async () => {
  await save('bob', 'shared')
  await save('alice', 'one', 1)
  expect(await save('alice', 'shared', 1)).toBe('deck_limit')
  expect(await deckCount('alice')).toBe(1)
})

test('given two accounts, when both connect the same slug, then each gets a deck and a binding of its own', async () => {
  expect(await save('bob', 'shared')).toBe('saved')
  expect(await save('alice', 'shared')).toBe('saved')
  const rows = await orm.select().from(decks).where(eq(decks.slug, 'shared'))
  expect(rows.map((row) => row.owner_user_id).sort()).toEqual(['alice', 'bob'])
  expect(new Set(rows.map((row) => row.id)).size).toBe(2)
  expect(await orm.$count(repositoryBindings)).toBe(2)
})

test('given a deck of an account, when it reconnects the slug, then the key stays and the binding is replaced', async () => {
  await save('alice', 'one')
  const [before] = await orm.select().from(decks)
  await save('alice', 'one')
  expect(await orm.select().from(decks)).toEqual([before])
  expect(await orm.$count(repositoryBindings)).toBe(1)
})

test('given a new deck, when it is connected, then its key is random and not its slug', async () => {
  await save('alice', 'one')
  const [row] = await orm.select().from(decks)
  expect(row?.slug).toBe('one')
  expect(row?.id).not.toBe('one')
  expect(row?.id).toMatch(/^[0-9a-f-]{36}$/)
})

test('given a session belonging to another GitHub owner, when a binding is saved, then no deck is created', async () => {
  const sessionId = await seedOwnerSession(db, 'bob')
  expect(
    await saveBinding(db, {
      ownerUserId: 'alice',
      sessionId,
      request: bindingRequestSchema.parse({
        deck: 'one',
        repository: 'piconic-ai/slide',
        branches: ['main'],
      }),
      repository,
      deckLimit: 2,
      now: 1,
    }),
  ).toBe('session_expired')
  expect(await deckCount('alice')).toBe(0)
})

test('given a session ID containing SQL punctuation, when a binding is saved, then it is treated as a literal and the session remains intact', async () => {
  const ownerUserId = '722500'
  const original = await seedOwnerSession(db, ownerUserId)
  const sessionId = "session'); DELETE FROM auth_session; --"
  await orm
    .update(authSession)
    .set({ id: sessionId })
    .where(eq(authSession.id, original))
  expect(
    await saveBinding(db, {
      ownerUserId,
      sessionId,
      request: bindingRequestSchema.parse({
        deck: 'one',
        repository: 'piconic-ai/slide',
        branches: ['main'],
      }),
      repository,
      deckLimit: 2,
      now: 1,
    }),
  ).toBe('saved')
  expect(await deckCount(ownerUserId)).toBe(1)
  expect(await orm.select({ id: authSession.id }).from(authSession)).toEqual([
    { id: sessionId },
  ])
})
