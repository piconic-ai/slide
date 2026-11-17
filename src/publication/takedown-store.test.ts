import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from './author'
import { readPublication, saveTransition } from './store'
import {
  applyOperatorCommand,
  readTakedown,
  saveTakedown,
} from './takedown-store'
import { decideAuthor, type AuthorCommand } from './transitions'
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

test.each([
  ['pauses', { kind: 'pause' }],
  ['changes the publication mode', { kind: 'set_mode', mode: 'repository' }],
] as const)(
  'F17-AC10: Given a public deck that is hidden, When the author %s, Then it is refused and nothing changes',
  async (_, command) => {
    const deploymentId = await seedDeployment(db, 'talk')
    await author({ kind: 'publish', deploymentId })
    await hide()
    const before = await readPublication(db, 'talk', OWNER_ID)
    expect(await author(command)).toMatchObject({ kind: 'hidden' })
    expect(await readPublication(db, 'talk', OWNER_ID)).toEqual(before)
  },
)

const racedCommands: [string, (id: string) => AuthorCommand][] = [
  ['a publish', (id) => ({ kind: 'publish', deploymentId: id })],
  ['a pause', () => ({ kind: 'pause' })],
]
test.each(racedCommands)(
  'F17-AC10: Given a decision made before a takedown landed, When %s is saved, Then the save is refused and the publication is unchanged',
  async (_, commandOf) => {
    const first = await seedDeployment(db, 'talk')
    await author({ kind: 'publish', deploymentId: first })
    const second = await seedDeployment(db, 'talk')
    const from = await readPublication(db, 'talk', OWNER_ID)
    if (!from) throw new Error('deck is missing')
    const decision = decideAuthor(from, commandOf(second), from.revision)
    if (decision.kind !== 'apply') throw new Error('expected a transition')
    await hide()
    expect(
      await saveTransition(db, {
        deckId: 'talk',
        ownerUserId: OWNER_ID,
        from,
        transition: decision.transition,
        now: 150,
      }),
    ).toBe(false)
    expect(await readPublication(db, 'talk', OWNER_ID)).toEqual(from)
  },
)

test('Given an operator identity too long to record, When a deck is hidden, Then it is refused without touching the database', async () => {
  expect(
    await applyOperatorCommand(db, {
      deckId: 'talk',
      command: { kind: 'hide', reason: 'r', operator: 'x'.repeat(321) },
      now: 1,
    }),
  ).toEqual({ kind: 'invalid_operator' })
  expect(await readTakedown(db, 'talk')).toBeNull()
})

test('Given a release decided against one takedown, When it is saved after another release and a new takedown, Then the new record and its refusal of publication stay', async () => {
  const deploymentId = await seedDeployment(db, 'talk')
  await hide('first', 100)
  const first = await readTakedown(db, 'talk')
  if (!first || first === 'missing') throw new Error('not hidden')
  await release()
  await hide('newly discovered phishing', 300)

  expect(
    await saveTakedown(db, { deckId: 'talk', from: first, next: null }),
  ).toBe(false)
  expect(await readTakedown(db, 'talk')).toEqual({
    hiddenAt: 300,
    reason: 'newly discovered phishing',
    operator: 'op@example.com',
  })
  expect(await author({ kind: 'publish', deploymentId })).toMatchObject({
    kind: 'hidden',
  })
})

test('Given a hide decided for a visible deck, When another takedown is stored first, Then the later save does not replace it', async () => {
  await hide('first', 100)
  expect(
    await saveTakedown(db, {
      deckId: 'talk',
      from: null,
      next: { hiddenAt: 200, reason: 'second', operator: 'other' },
    }),
  ).toBe(false)
  expect(await readTakedown(db, 'talk')).toMatchObject({ reason: 'first' })
})
