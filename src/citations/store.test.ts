import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  accounts,
  citations,
  decks,
  deployments,
  suspensions,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckSlugSchema } from '../decks/deck-id'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { LINK_SCAN_BYTES, recordCitations } from './citation-store'
import { DECKS_SHOWN } from './citing'
import { readCitedBy, readCites } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

const READER_ID = '999'

let talk = ''
let reply = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner".
  await signIn(env)
  talk = await seedPublic(db, 'talk', 1, 'Talk')
  await orm
    .insert(accounts)
    .values({ user_id: READER_ID, handle: 'reader', created_at: 1 })
  reply = await seedPublic(db, 'reply', 2, 'Reply', READER_ID)
})
afterAll(() => platform.dispose())

const cite = (
  deploymentId: string,
  slug: string,
  page: number,
  handle = 'owner',
) =>
  orm.insert(citations).values({
    deployment_id: deploymentId,
    target_handle: handle,
    target_slug: slug,
    target_page: page,
  })

const talkSlug = deckSlugSchema.parse('talk')

/** The decks citing @owner/talk, as a reader with no session is shown them. */
const citingTalk = () => readCitedBy(db, 'owner', talkSlug, DECKS_SHOWN, null)

const namesOf = (shown: readonly { handle: string; slug: string }[]) =>
  shown.map((deck) => `${deck.handle}/${deck.slug}`)

const point = (deck: string, deploymentId: string | null) =>
  orm
    .update(decks)
    .set({ public_deployment_id: deploymentId })
    .where(eq(decks.id, deck))

/** Stores a deployment's files as an upload leaves them. */
async function storeFiles(deployment: string, files: Record<string, string>) {
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `${deployment}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: deployment,
      id: String(index),
      path,
      size: body.length,
      sha256: 'x',
      media_type: path.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8',
      object_key: key,
    })
  }
}

const recorded = async (deployment: string) =>
  (
    await orm
      .select()
      .from(citations)
      .where(eq(citations.deployment_id, deployment))
  )
    .map((row) => `${row.target_handle}/${row.target_slug}/${row.target_page}`)
    .sort()

test('F24-AC3: Given a public deck linking to two pages of a deck, When the decks citing the cited deck are read, Then the citing deck is there once, with the version and cover readers see', async () => {
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)
  await orm
    .update(deployments)
    .set({ cover_path: 'og.png' })
    .where(eq(deployments.id, reply))

  expect(await citingTalk()).toEqual({
    decks: [
      {
        handle: 'reader',
        slug: 'reply',
        title: 'Reply',
        deploymentId: reply,
        coverPath: 'og.png',
        at: 2,
      },
    ],
    total: 1,
  })
})

test('F24-AC3: Given a public deck linking to several pages of a deck and to the deck, When the decks it cites are read, Then the cited deck is there once', async () => {
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)
  await cite(reply, 'talk', 0)

  expect(
    await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
  ).toEqual([
    {
      handle: 'owner',
      slug: 'talk',
      title: 'Talk',
      deploymentId: talk,
      coverPath: null,
      at: 1,
    },
  ])
})

test('F24-AC5: Given the citing deck stops being public, When the decks citing the cited deck are read, Then it is gone, and it is back once public again', async () => {
  await cite(reply, 'talk', 6)
  await point('reply', null)

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })

  await point('reply', reply)

  expect(namesOf((await citingTalk()).decks)).toEqual(['reader/reply'])
})

test('F24-AC17: Given links to a draft, a stopped and an unknown deck, When the decks the citing deck cites are read, Then nothing tells that they exist, until the draft is published', async () => {
  await seedDeck(db, 'draft')
  const draft = await seedDeployment(db, 'draft')
  await seedPublic(db, 'stopped', 3, 'Stopped')
  await point('stopped', null)
  await cite(reply, 'draft', 2)
  await cite(reply, 'stopped', 0)
  await cite(reply, 'missing', 0, 'nobody')

  expect(
    await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
  ).toEqual([])

  await point('draft', draft)

  expect(
    namesOf(
      await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
    ),
  ).toEqual(['owner/draft'])
})

test('F24-AC6: Given more citing decks than are shown, When the decks citing the cited deck are read, Then only the latest are given and all are counted', async () => {
  for (const [index, slug] of ['a', 'b', 'c', 'd', 'e', 'f'].entries())
    await cite(
      await seedPublic(db, `reply-${slug}`, 10 + index, slug, READER_ID),
      'talk',
      0,
    )

  const { decks: shown, total } = await citingTalk()

  // The newest was published last; the two oldest are left out.
  expect(namesOf(shown)).toEqual([
    'reader/reply-f',
    'reader/reply-e',
    'reader/reply-d',
    'reader/reply-c',
  ])
  expect(total).toBe(6)
})

test('F24-AC1, F24-AC2: Given a deck that is cited and cites another, When both sides are read, Then each side names the other deck', async () => {
  await cite(reply, 'talk', 6)
  await cite(talk, 'reply', 0, 'reader')

  expect(namesOf((await citingTalk()).decks)).toEqual(['reader/reply'])
  expect(
    namesOf(await readCites(db, { deckId: 'talk', deploymentId: talk }, null)),
  ).toEqual(['reader/reply'])
})

test('F24-AC4: Given uploaded HTML files linking to decks, When citations are recorded, Then links from every HTML file are kept once, a link to the deck itself is not, and a link to another deck of the same author is', async () => {
  await seedPublic(db, 'sequel', 3, 'Sequel')
  const deployment = await seedDeployment(db, 'talk')
  await storeFiles(deployment, {
    'index.html': `<a href="${TEST_ORIGIN}/@reader/reply/2">reply</a>
      <a href="${TEST_ORIGIN}/@owner/talk/9">self</a>
      <a href="${TEST_ORIGIN}/@owner/sequel">same author</a>`,
    'slides/001.html': `<a href="${TEST_ORIGIN}/@reader/reply/2">again</a>
      <a href="${TEST_ORIGIN}/@reader/reply">whole</a>`,
    'notes.txt': `<a href="${TEST_ORIGIN}/@reader/reply/7">not HTML</a>`,
  })

  await recordCitations(env, deployment)
  await recordCitations(env, deployment)

  expect(await recorded(deployment)).toEqual([
    'owner/sequel/0',
    'reader/reply/0',
    'reader/reply/2',
  ])
  await point('talk', deployment)
  expect(
    namesOf(
      await readCites(db, { deckId: 'talk', deploymentId: deployment }, null),
    ),
  ).toEqual(['owner/sequel', 'reader/reply'])
})

test('F24-AC4: Given a link to the deck itself that was kept before the deck had its names, When either side is read, Then the deck does not cite itself', async () => {
  await cite(talk, 'talk', 3)

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })
  expect(
    await readCites(db, { deckId: 'talk', deploymentId: talk }, null),
  ).toEqual([])
})

test('F24-AC13: Given a public citing deck that receives a new version without the link, When the lists are read, Then they do not change until the public version is replaced, and then the citation is gone and the new one counts', async () => {
  await seedPublic(db, 'other', 3, 'Other')
  await cite(reply, 'talk', 6)
  const next = await seedDeployment(db, 'reply')
  await cite(next, 'other', 0)

  expect(namesOf((await citingTalk()).decks)).toEqual(['reader/reply'])
  expect(
    namesOf(
      await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
    ),
  ).toEqual(['owner/talk'])

  await point('reply', next)

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })
  expect(
    namesOf(await readCites(db, { deckId: 'reply', deploymentId: next }, null)),
  ).toEqual(['owner/other'])
  const citingOther = await readCitedBy(
    db,
    'owner',
    deckSlugSchema.parse('other'),
    DECKS_SHOWN,
    null,
  )
  expect(citingOther.decks.map((deck) => deck.deploymentId)).toEqual([next])
})

test('F24-AC13: Given a new version of the citing deck that is still uploading, When its links are in the store, Then readers of the cited deck do not see it', async () => {
  const uploading = await seedDeployment(db, 'reply', 'uploading')
  await cite(uploading, 'talk', 1)

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })
})

const hideDeck = (deckId: string) =>
  applyOperatorCommand(db, {
    deckId,
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 5,
  })

const suspend = (userId: string) =>
  orm.insert(suspensions).values({
    user_id: userId,
    reason: 'spam',
    suspended_at: 5,
    suspended_by: 'op',
  })

test('F24-AC8, F17-AC8: Given a citing deck an operator hid, When the decks citing the cited deck are read, Then the citation is gone', async () => {
  await cite(reply, 'talk', 6)
  expect(namesOf((await citingTalk()).decks)).toEqual(['reader/reply'])
  await hideDeck('reply')

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })
})

test('F24-AC8, F17-AC8: Given a cited deck an operator hid, When the decks the citing deck cites are read, Then nothing tells that the cited deck exists', async () => {
  await cite(reply, 'talk', 6)
  expect(
    namesOf(
      await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
    ),
  ).toEqual(['owner/talk'])
  await hideDeck('talk')

  expect(
    await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
  ).toEqual([])
})

test('F24-AC8: Given the author of a citing deck is suspended, When the decks citing the cited deck are read, Then that deck is not listed or counted', async () => {
  await cite(reply, 'talk', 6)
  await suspend(READER_ID)

  expect(await citingTalk()).toEqual({ decks: [], total: 0 })
})

test('F24-AC8: Given the author of a cited deck is suspended, When the decks the citing deck cites are read, Then that deck is not listed', async () => {
  await cite(reply, 'talk', 6)
  await suspend(OWNER_ID)

  expect(
    await readCites(db, { deckId: 'reply', deploymentId: reply }, null),
  ).toEqual([])
})

test('Given a stored HTML file that cannot be read, When citations are recorded, Then the upload goes on without them', async () => {
  const deployment = await seedDeployment(db, 'talk')
  await storeFiles(deployment, {
    'index.html': `<a href="${TEST_ORIGIN}/@reader/reply">reply</a>`,
  })
  const failing = {
    ...env,
    UPLOADS: {
      get: async () => {
        throw new Error('storage is down')
      },
    },
  } as unknown as Env
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

  await expect(recordCitations(failing, deployment)).resolves.toBeUndefined()

  expect(await recorded(deployment)).toEqual([])
  expect(logged).toHaveBeenCalledOnce()
  logged.mockRestore()
})

test('Given a deployment whose HTML file is gone from storage, When citations are recorded, Then that file gives none', async () => {
  const deployment = await seedDeployment(db, 'talk')
  await storeFiles(deployment, {
    'index.html': `<a href="${TEST_ORIGIN}/@reader/reply">reply</a>`,
  })
  await platform.env.UPLOADS.delete(`${deployment}/0/lease`)

  await recordCitations(env, deployment)

  expect(await recorded(deployment)).toEqual([])
})

test('F24-AC1: Given an HTML file longer than what is read, cut in the middle of a bare link, When citations are recorded, Then the cut link is not kept as a link to another deck, and the links before it are', async () => {
  await seedPublic(db, 'talk-lo', 3, 'Another deck')
  const deployment = await seedDeployment(db, 'reply')
  const head = `<a href=${TEST_ORIGIN}/@owner/talk/3>whole</a>`
  const cutAt = `<a href=${TEST_ORIGIN}/@owner/talk-lo`
  const filler = ' '.repeat(LINK_SCAN_BYTES - head.length - cutAt.length)
  await storeFiles(deployment, {
    'index.html': `${head}${filler}${cutAt}ng>the long talk</a>`,
  })

  await recordCitations(env, deployment)

  expect(await recorded(deployment)).toEqual(['owner/talk/3'])
})

test('Given a version of twenty full HTML files holding nothing but links that are no URL, When citations are recorded, Then it ends in time for the upload to go on, with no citation', async () => {
  const deployment = await seedDeployment(db, 'reply')
  const body = 'href=a '.repeat(Math.floor(LINK_SCAN_BYTES / 7))
  await storeFiles(
    deployment,
    Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`p${index}.html`, body]),
    ),
  )
  const started = performance.now()

  await recordCitations(env, deployment)

  // Before links were looked at cheaply first, this took over ten seconds.
  expect(performance.now() - started).toBeLessThan(5000)
  expect(await recorded(deployment)).toEqual([])
}, 60000)
