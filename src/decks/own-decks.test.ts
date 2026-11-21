import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
} from '../publication/test-support'
import { ownDeckName, toOwnDeck, type OwnDeckRow } from './own-decks'
import { listOwnDecks } from './own-decks-store'

const row = (changes: Partial<OwnDeckRow> = {}): OwnDeckRow => ({
  slug: 'talk',
  created_at: 10,
  public_deployment_id: null,
  paused_at: null,
  hidden_at: null,
  shown_id: null,
  shown_title: null,
  shown_cover_path: null,
  newest_ready_at: null,
  ...changes,
})

test.each([
  ['never published', {}, false],
  ['public', { public_deployment_id: 'd1' }, true],
  [
    'public but hidden by an operator',
    { public_deployment_id: 'd1', hidden_at: 5 },
    false,
  ],
  // A paused deck holds no public pointer, but the two are told apart anyway.
  ['paused', { paused_at: 5 }, false],
  [
    'a public pointer beside a pause',
    { public_deployment_id: 'd1', paused_at: 5 },
    false,
  ],
] as const)(
  'Given a slide that is %s, When it is told for the list, Then readers can open it: %s',
  (_state, changes, isPublic) => {
    expect(toOwnDeck(row(changes)).isPublic).toBe(isPublic)
  },
)

test('Given a slide nothing was received for, When it is told for the list, Then it shows no version, is named by its URL name and dated by its creation', () => {
  const deck = toOwnDeck(row())
  expect(deck.shown).toBeNull()
  expect(ownDeckName(deck)).toBe('talk')
  expect(deck.updatedAt).toBe(10)
})

test.each([
  ['a title', 'My <b>talk</b>', 'My <b>talk</b>'],
  ['no title', null, 'talk'],
  // An empty title is a title the author gave; it is not replaced.
  ['an empty title', '', ''],
])(
  'Given a slide whose shown version has %s, When it is named, Then the name is %j',
  (_case, title, name) => {
    const deck = toOwnDeck(
      row({ shown_id: 'd1', shown_title: title, newest_ready_at: 20 }),
    )
    expect(ownDeckName(deck)).toBe(name)
    expect(deck.updatedAt).toBe(20)
  },
)

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

test('Given an author with no slide, When their slides are listed, Then the list is empty', async () => {
  expect(await listOwnDecks(db, OWNER_ID)).toEqual([])
})

test('Given slides in every state and slides of someone else, When an author’s slides are listed, Then only their own live ones come, the most recently changed first, each with the version its card shows', async () => {
  // A draft with a ready version and a newer one still uploading.
  await seedDeck(db, 'draft')
  const draftReady = await seedDeployment(db, 'draft')
  await seedDeployment(db, 'draft', 'uploading')
  await orm
    .update(deployments)
    .set({ ready_at: 50, title: 'Draft' })
    .where(eq(deployments.id, draftReady))
  // A public deck whose newest ready version is not the public one.
  const publicId = await seedPublic(db, 'public', 30, 'Public')
  const newer = await seedDeployment(db, 'public')
  await orm
    .update(deployments)
    .set({ ready_at: 90, title: 'Next', cover_path: 'next.png' })
    .where(eq(deployments.id, newer))
  // Nothing received yet.
  await seedDeck(db, 'empty')
  // Deleted, and another author's: neither is listed.
  await seedPublic(db, 'gone', 70, 'Gone')
  await orm
    .update(decks)
    .set({ deleted_at: 80, public_deployment_id: null })
    .where(eq(decks.id, 'gone'))
  await seedPublic(db, 'theirs', 99, 'Theirs', '999', 'public')

  const list = await listOwnDecks(db, OWNER_ID)

  expect(list).toEqual([
    {
      slug: 'public',
      isPublic: true,
      // The card shows what readers see, not the newer draft.
      shown: { deploymentId: publicId, title: 'Public', coverPath: null },
      updatedAt: 90,
    },
    {
      slug: 'draft',
      isPublic: false,
      shown: { deploymentId: draftReady, title: 'Draft', coverPath: null },
      updatedAt: 50,
    },
    { slug: 'empty', isPublic: false, shown: null, updatedAt: 1 },
  ])
})

test('Given a slide name, When the author’s slides are listed for it, Then only that slide comes, and another author’s slide of the same name does not', async () => {
  await seedDeck(db, 'mine', OWNER_ID, 'talk')
  await seedDeck(db, 'other', OWNER_ID, 'other')
  await seedPublic(db, 'theirs', 5, 'Theirs', '999', 'talk')

  expect((await listOwnDecks(db, OWNER_ID, 'talk')).map((d) => d.slug)).toEqual(
    ['talk'],
  )
  expect((await listOwnDecks(db, OWNER_ID, 'talk'))[0]?.shown).toBeNull()
  expect(await listOwnDecks(db, OWNER_ID, 'missing')).toEqual([])
  expect(await listOwnDecks(db, 'nobody', 'talk')).toEqual([])
})
