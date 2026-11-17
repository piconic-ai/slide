import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from './author'
import { readPublication } from './store'
import { applyOperatorCommand, readTakedown } from './takedown-store'
import { OWNER_ID, resetTables, seedDeck, seedDeployment } from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

const hide = (reason = 'fake sign-in page', now = 100) =>
  applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'hide', reason, operator: 'op@example.com' },
    now,
  })
const release = () =>
  applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'release' },
    now: 200,
  })
const author = async (
  command: Parameters<typeof applyAuthorCommand>[1]['command'],
) => {
  const current = await readPublication(db, 'talk', OWNER_ID)
  return applyAuthorCommand(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command,
    expectedRevision: current?.revision ?? 0,
    now: 150,
  })
}
const publication = async () =>
  (await readPublication(db, 'talk', OWNER_ID))?.publication

test('Given a visible deck, When an operator hides it, Then the takedown is stored with its reason, time, and operator', async () => {
  expect(await hide()).toEqual({
    kind: 'applied',
    takedown: {
      hiddenAt: 100,
      reason: 'fake sign-in page',
      operator: 'op@example.com',
    },
  })
  expect(await readTakedown(db, 'talk')).toEqual({
    hiddenAt: 100,
    reason: 'fake sign-in page',
    operator: 'op@example.com',
  })
})

test('Given a hidden deck, When it is hidden again, Then the first record stays', async () => {
  await hide('first', 100)
  expect(await hide('second', 300)).toEqual({ kind: 'unchanged' })
  expect(await readTakedown(db, 'talk')).toMatchObject({
    hiddenAt: 100,
    reason: 'first',
  })
})

test('Given an empty reason, When an operator hides a deck, Then nothing is stored', async () => {
  expect(await hide('  ')).toEqual({ kind: 'invalid_reason' })
  expect(await readTakedown(db, 'talk')).toBeNull()
})

test.each(['unknown', 'gone'])(
  'Given the deck %s does not exist or is deleted, When an operator hides it, Then it is not found',
  async (deckId) => {
    await seedDeck(db, 'gone')
    await drizzle(db)
      .update(decks)
      .set({ deleted_at: 1 })
      .where(eq(decks.id, 'gone'))
    expect(
      await applyOperatorCommand(db, {
        deckId,
        command: { kind: 'hide', reason: 'r', operator: 'op' },
        now: 1,
      }),
    ).toEqual({ kind: 'not_found' })
  },
)

test('F17-AC10: Given a hidden draft deck, When the author publishes a ready deployment, Then it is refused and the publication stays a draft', async () => {
  const deploymentId = await seedDeployment(db, 'talk')
  await hide()
  const before = await readPublication(db, 'talk', OWNER_ID)
  expect(await author({ kind: 'publish', deploymentId })).toMatchObject({
    kind: 'hidden',
  })
  expect(await readPublication(db, 'talk', OWNER_ID)).toEqual(before)
})

test('F17-AC10: Given a paused deck that is hidden, When the author resumes, Then it is refused and the deck stays paused', async () => {
  const deploymentId = await seedDeployment(db, 'talk')
  await author({ kind: 'publish', deploymentId })
  await author({ kind: 'pause' })
  await hide()
  expect(await author({ kind: 'resume' })).toMatchObject({ kind: 'hidden' })
  expect(await publication()).toEqual({
    kind: 'paused',
    resumeTo: deploymentId,
  })
})

test.each([
  ['public', async () => {}],
  ['paused', () => author({ kind: 'pause' })],
] as const)(
  'F17-AC11: Given a %s deck, When an operator hides and then releases it, Then the publication is what it was before',
  async (_, arrange) => {
    const deploymentId = await seedDeployment(db, 'talk')
    await author({ kind: 'publish', deploymentId })
    await arrange()
    const before = await readPublication(db, 'talk', OWNER_ID)
    await hide()
    expect(await readPublication(db, 'talk', OWNER_ID)).toEqual(before)
    expect(await release()).toEqual({ kind: 'applied', takedown: null })
    expect(await readPublication(db, 'talk', OWNER_ID)).toEqual(before)
    expect(await readTakedown(db, 'talk')).toBeNull()
  },
)

test('F17-AC11: Given a draft deck, When an operator hides and then releases it, Then it is still a draft and can be published again', async () => {
  const deploymentId = await seedDeployment(db, 'talk')
  await hide()
  await release()
  expect(await publication()).toEqual({ kind: 'draft' })
  expect(await author({ kind: 'publish', deploymentId })).toMatchObject({
    kind: 'applied',
  })
})

test('Given a visible deck, When an operator releases it, Then nothing changes', async () => {
  expect(await release()).toEqual({ kind: 'unchanged' })
})

test('Given a hidden deck, When the author pauses, Then the pause applies, because it only stops delivery', async () => {
  const deploymentId = await seedDeployment(db, 'talk')
  await author({ kind: 'publish', deploymentId })
  await hide()
  expect(await author({ kind: 'pause' })).toMatchObject({ kind: 'applied' })
})
