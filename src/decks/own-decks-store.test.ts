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
import { listOwnDecks } from './own-decks-store'

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
