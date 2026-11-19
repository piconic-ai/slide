import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  citations,
  decks,
  deployments,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const READER_ID = '999'

let owner = ''
let reply = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  await seedPublic(db, 'talk', 1, 'Talk')
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

const open = (path: string, cookie = '', lang = 'ja') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: { Cookie: cookie, 'Accept-Language': lang },
    }),
    env,
  )

/** The frame of the deck page that lists the citing slides, or null. */
const citedByFrameOf = (page: string) =>
  /<section data-deck-frame="cited-by">[\s\S]*?<\/section>/.exec(page)?.[0] ??
  null

/** The share paths of the cards in a piece of a page, in order. */
const cardLinks = (part: string) =>
  [...part.matchAll(/<a class="card-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )

test('F24-AC11: Given public slides of other authors that cite the author’s slides, When the author opens the page of those slides, Then every citing deck is a cover card under the heading, newest first and none cut', async () => {
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)
  for (const [index, slug] of ['a', 'b', 'c', 'd', 'e'].entries())
    await cite(
      await seedPublic(db, `reply-${slug}`, 10 + index, slug, READER_ID),
      'talk',
      0,
    )
  await orm
    .update(deployments)
    .set({ cover_path: 'img/og.png' })
    .where(eq(deployments.id, reply))

  const response = await open('/slides/talk', owner)

  expect(response.status).toBe(200)
  const frame = citedByFrameOf(await response.text())
  expect(frame).toContain(
    '<h2 id="cited-by">このスライドを引用しているスライド</h2>',
  )
  // Six decks cite the slides; the one linking to two pages is listed once.
  expect(cardLinks(frame ?? '')).toEqual([
    '/@reader/reply-e',
    '/@reader/reply-d',
    '/@reader/reply-c',
    '/@reader/reply-b',
    '/@reader/reply-a',
    '/@reader/reply',
  ])
  expect(frame).toContain(`src="https://d-${reply}.content.example/img/og.png"`)
  expect(frame).toContain('<a href="/@reader">@reader</a>')
  expect(frame).toContain('1970年1月1日')
  // A card is a link with a picture: no deck runs on the author's page.
  expect(frame).not.toContain('<iframe')
})

test('F24-AC11: Given the page is read in English, When the author opens it, Then the heading and the day are in English', async () => {
  await cite(reply, 'talk', 0)

  const frame = citedByFrameOf(
    await (await open('/slides/talk', owner, 'en')).text(),
  )

  expect(frame).toContain('<h2 id="cited-by">Slides citing these slides</h2>')
  expect(frame).toContain('Jan 1, 1970')
})

test('F24-AC11: Given no public deck cites the author’s slides, When the author opens their page, Then the frame is left out, heading and all', async () => {
  const page = await (await open('/slides/talk', owner)).text()

  expect(citedByFrameOf(page)).toBeNull()
  expect(page).not.toContain('このスライドを引用しているスライド')
})

test('F24-AC11, F24-AC5: Given the citing deck stops being public, When the author opens their page, Then that deck is not listed, and it is back once public again', async () => {
  await cite(reply, 'talk', 0)
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'reply'))

  expect(
    citedByFrameOf(await (await open('/slides/talk', owner)).text()),
  ).toBeNull()

  await orm
    .update(decks)
    .set({ public_deployment_id: reply })
    .where(eq(decks.id, 'reply'))

  expect(cardLinks(await (await open('/slides/talk', owner)).text())).toContain(
    '/@reader/reply',
  )
})

test.each([
  [
    'an operator hid the citing deck',
    () =>
      applyOperatorCommand(db, {
        deckId: 'reply',
        command: { kind: 'hide', reason: 'phishing', operator: 'op' },
        now: 5,
      }),
  ],
  [
    'the citing deck’s author is suspended',
    () =>
      orm.insert(suspensions).values({
        user_id: READER_ID,
        reason: 'spam',
        suspended_at: 5,
        suspended_by: 'op',
      }),
  ],
])(
  'F24-AC11, F24-AC8: Given %s, When the author opens the page of the cited slides, Then that deck is not listed',
  async (_, act) => {
    await cite(reply, 'talk', 0)
    await act()

    expect(
      citedByFrameOf(await (await open('/slides/talk', owner)).text()),
    ).toBeNull()
  },
)

test('F24-AC11: Given the author’s own slides are not public yet, When a public deck already links to their share URL, Then the author’s page lists that deck', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await cite(reply, 'draft', 0)

  const page = await (await open('/slides/draft', owner)).text()

  expect(cardLinks(citedByFrameOf(page) ?? '')).toEqual(['/@reader/reply'])
})

test('F24-AC11: Given a citing deck whose title is markup, When the author opens their page, Then the title shows as text', async () => {
  await cite(reply, 'talk', 0)
  await orm
    .update(deployments)
    .set({ title: '<img src=x onerror=alert(1)> & "more"' })
    .where(eq(deployments.id, reply))

  const frame = citedByFrameOf(await (await open('/slides/talk', owner)).text())

  expect(frame).toContain(
    '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;more&quot;',
  )
  expect(frame).not.toContain('<img src=x')
})

test('F24-AC11: Given another author’s slides, When someone who does not own them opens their page, Then it looks like no deck and lists nothing', async () => {
  await cite(reply, 'talk', 0)

  const signedOut = await open('/slides/talk')
  const page = await signedOut.text()

  expect(signedOut.status).toBe(401)
  expect(page).not.toContain('/@reader/reply')
  // The reader of the test owns "reply", not "talk".
  const other = await open('/slides/reply', owner)
  expect(other.status).toBe(404)
})
