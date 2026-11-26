import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { readArticle } from './store'
import server from '../app/routes'
import { citations, decks, mutes, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
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

let owner = ''
let reader = ''
/** The public version of the reader's slides. */
let replyVersion = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  reader = await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'talk', 1, 'Talk')
  replyVersion = await seedPublic(db, 'reply', 2, 'Reply', INVITED_ID)
})
afterAll(() => platform.dispose())

const send = async (
  cookie: string,
  deck: string,
  fields: Record<string, string>,
  path = '',
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/${deck}/article${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        revision: String((await readArticle(db, deck))?.revision ?? ''),
        ...fields,
      }).toString(),
    }),
    env,
  )

/** The viewer's list of the slides that cite these, as card links. */
async function citedBy(path = '/@owner/talk', cookie = '') {
  const page = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
      env,
    )
  ).text()
  const part =
    /<div data-reader-lists="cited-by">([\s\S]*?)<\/div>\s*(?:<div data-reader-lists|(?:<\/div>\s*)?<\/main>)/.exec(
      page,
    )?.[1] ?? ''
  return [...part.matchAll(/<a class="card-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )
}

const REPLY = { deck: 'reply' }
/** Keeps the text as the box does, then publishes it from the slide's page. */
const publishAs = async (who: string, deck: string, body: string) => {
  await send(who, deck, { body }, '/autosave')
  return send(who, deck, { action: 'publish' }, '/publication')
}
const publish = (body: string) => publishAs(reader, REPLY.deck, body)

test('F24-AC19: Given a published article with a link in a sentence, When the cited slides’ viewer opens, Then the article’s slides are listed as citing them', async () => {
  expect(await citedBy()).toEqual([])
  await publish(`I agree with [the talk](${TEST_ORIGIN}/@owner/talk/6).`)
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC19: Given a published article with a page image paragraph and a bare deck URL, When the cited slides’ viewer opens, Then each makes the one citation', async () => {
  await publish(`${TEST_ORIGIN}/@owner/talk/3\n\n${TEST_ORIGIN}/@owner/talk`)
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC19: Given the cited slides’ page URL written with capitals and a trailing slash, When the article is published, Then it is the same citation', async () => {
  await publish(`see ${TEST_ORIGIN}/@OWNER/Talk/6/ here`)
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC20: Given a citation from an article, When the article is unpublished and published again, Then it leaves the list and comes back', async () => {
  const body = `[x](${TEST_ORIGIN}/@owner/talk)`
  await publish(body)
  expect(await citedBy()).toEqual(['/@reader/reply'])
  await send(reader, 'reply', { action: 'unpublish' }, '/publication')
  expect(await citedBy()).toEqual([])
  await publish(body)
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC20: Given a draft that was never published, When the cited slides’ viewer opens, Then there is no citation', async () => {
  await send(
    reader,
    'reply',
    { body: `[x](${TEST_ORIGIN}/@owner/talk)` },
    '/autosave',
  )
  expect(await citedBy()).toEqual([])
})

test('F24-AC20: Given a published article whose text is edited to drop the link, When the publication is updated, Then the citation goes', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await send(reader, 'reply', { action: 'update', body: 'no link now' })
  expect(await citedBy()).toEqual([])
})

test('F24-AC21: Given an article that links to its own slides, When it is published, Then the slides do not cite themselves, and the link makes no citation row', async () => {
  await publishAs(
    owner,
    'talk',
    `${TEST_ORIGIN}/@owner/talk/3 and [me](${TEST_ORIGIN}/@owner/talk)`,
  )
  expect(await citedBy()).toEqual([])
})

test('F24-AC21: Given an article of another of the author’s slides, When it links to the first, Then it counts, as links between one author’s slides do', async () => {
  await seedPublic(db, 'second', 3, 'Second')
  await publishAs(owner, 'second', `${TEST_ORIGIN}/@owner/talk/2`)
  expect(await citedBy()).toEqual(['/@owner/second'])
})

test('F24-AC19: Given a citing article whose slides are not public, When the cited slides’ viewer opens, Then it is not listed, and it is when they are public again', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  const point = (id: string | null) =>
    orm
      .update(decks)
      .set({ public_deployment_id: id })
      .where(eq(decks.id, 'reply'))
  const [before] = await orm.select().from(decks).where(eq(decks.id, 'reply'))
  await point(null)
  expect(await citedBy()).toEqual([])
  await point(before?.public_deployment_id ?? null)
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC19: Given a citing article, When its slides get a new public version, Then the citation stays', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  const next = await seedDeployment(db, 'reply')
  await orm
    .update(decks)
    .set({ public_deployment_id: next })
    .where(eq(decks.id, 'reply'))
  expect(await citedBy()).toEqual(['/@reader/reply'])
})

test('F24-AC19: Given slides that cite by their HTML and by their article, When the viewer opens, Then they are listed once', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  expect(
    (await citedBy()).filter((href) => href === '/@reader/reply'),
  ).toHaveLength(1)
})

/**
 * The viewer's list of the slides these slides cite, as card links, and the
 * count of the ones left out.
 */
async function cites(path = '/@reader/reply', cookie = '') {
  const page = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
      env,
    )
  ).text()
  const part =
    /<div data-reader-lists="cites">([\s\S]*?)<\/div>\s*<div data-reader-lists/.exec(
      page,
    )?.[1] ?? ''
  return {
    cards: [...part.matchAll(/<a class="card-title" href="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    more: /ほか (\d+) 件/.exec(part)?.[1] ?? null,
  }
}

const citedCards = async (path?: string, cookie?: string) =>
  (await cites(path, cookie)).cards

/** Makes the reader's public version link to @owner/<slug> in its HTML. */
const citeInHtml = (slug: string) =>
  orm.insert(citations).values({
    deployment_id: replyVersion,
    target_handle: 'owner',
    target_slug: slug,
    target_page: 0,
  })

const pointTalk = (id: string | null) =>
  orm
    .update(decks)
    .set({ public_deployment_id: id })
    .where(eq(decks.id, 'talk'))

test('F24-AC36: Given a published article with a link in a sentence, When the citing slides’ viewer opens, Then the cited slides are listed as cited', async () => {
  expect(await citedCards()).toEqual([])
  await publish(`I agree with [the talk](${TEST_ORIGIN}/@owner/talk/6).`)
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC36: Given a published article with a page image paragraph, When the citing slides’ viewer opens, Then the cited slides are listed as cited', async () => {
  await publish(`${TEST_ORIGIN}/@owner/talk/3`)
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC37: Given slides that cite by their HTML and by their article, When the citing slides’ viewer opens, Then the cited slides are listed once', async () => {
  await citeInHtml('talk')
  await publish(
    `${TEST_ORIGIN}/@owner/talk/3\n\n[again](${TEST_ORIGIN}/@owner/talk)`,
  )
  expect(await cites()).toEqual({ cards: ['/@owner/talk'], more: null })
})

test('F24-AC38: Given a citation only from an article, When the article is unpublished and published again, Then it leaves the citing slides’ list and comes back', async () => {
  const body = `[x](${TEST_ORIGIN}/@owner/talk)`
  await publish(body)
  expect(await citedCards()).toEqual(['/@owner/talk'])
  await send(reader, 'reply', { action: 'unpublish' }, '/publication')
  expect(await citedCards()).toEqual([])
  await publish(body)
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC38: Given slides that cite by their HTML and by their article, When the article is unpublished, Then the cited slides stay listed', async () => {
  await citeInHtml('talk')
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await send(reader, 'reply', { action: 'unpublish' }, '/publication')
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC36, F26-AC95: Given a draft never published, or a published article whose unpublished edit adds a link, When the citing slides’ viewer opens, Then neither link is listed', async () => {
  await send(
    reader,
    'reply',
    { body: `[x](${TEST_ORIGIN}/@owner/talk)` },
    '/autosave',
  )
  expect(await citedCards()).toEqual([])
  await seedPublic(db, 'second', 3, 'Second')
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await send(
    reader,
    'reply',
    {
      body: `[x](${TEST_ORIGIN}/@owner/talk) [y](${TEST_ORIGIN}/@owner/second)`,
    },
    '/autosave',
  )
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC21, F24-AC36: Given an article that links to its own slides and to another of the author’s, When the viewer of its slides opens, Then only the other slides are listed as cited', async () => {
  await seedPublic(db, 'second', 3, 'Second')
  await publishAs(
    owner,
    'talk',
    `${TEST_ORIGIN}/@owner/talk/3 and [me](${TEST_ORIGIN}/@owner/talk) and [it](${TEST_ORIGIN}/@owner/second)`,
  )
  expect(await citedCards('/@owner/talk')).toEqual(['/@owner/second'])
})

test('F24-AC17, F24-AC36: Given an article citing slides that are not public, When the citing slides’ viewer opens, Then nothing tells they exist, until they are public again', async () => {
  await publish(
    `[x](${TEST_ORIGIN}/@owner/talk) [y](${TEST_ORIGIN}/@nobody/missing)`,
  )
  const [before] = await orm.select().from(decks).where(eq(decks.id, 'talk'))
  await pointTalk(null)
  expect(await citedCards()).toEqual([])
  await pointTalk(before?.public_deployment_id ?? null)
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC8, F24-AC36: Given an article citing slides an operator hid, When the citing slides’ viewer opens, Then they are not listed', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 5,
  })
  expect(await citedCards()).toEqual([])
})

test('F24-AC8, F24-AC36: Given an article citing slides of a suspended author, When the citing slides’ viewer opens, Then they are not listed', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await orm.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'spam',
    suspended_at: 5,
    suspended_by: 'op',
  })
  expect(await citedCards()).toEqual([])
})

test('F24-AC8, F24-AC36: Given an article citing slides of an author the reader mutes, When that reader opens the citing slides’ viewer, Then they are not listed to them, and are to others', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  await orm.insert(mutes).values({
    muter_user_id: INVITED_ID,
    muted_user_id: OWNER_ID,
    created_at: 5,
  })
  expect(await citedCards('/@reader/reply', reader)).toEqual([])
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC36: Given a citing article, When its slides get a new public version, Then the cited slides stay listed', async () => {
  await publish(`[x](${TEST_ORIGIN}/@owner/talk)`)
  const next = await seedDeployment(db, 'reply')
  await orm
    .update(decks)
    .set({ public_deployment_id: next })
    .where(eq(decks.id, 'reply'))
  expect(await citedCards()).toEqual(['/@owner/talk'])
})

test('F24-AC6, F24-AC36: Given more cited slides than are shown, from the HTML and the article, When the citing slides’ viewer opens, Then the latest published four are shown and the rest are counted', async () => {
  await citeInHtml('talk')
  const slugs = ['b1', 'b2', 'b3', 'b4', 'b5']
  for (const [index, slug] of slugs.entries())
    await seedPublic(db, slug, 10 + index, slug.toUpperCase())
  await publish(
    slugs.map((slug) => `[${slug}](${TEST_ORIGIN}/@owner/${slug})`).join(' '),
  )
  expect(await cites()).toEqual({
    cards: ['/@owner/b5', '/@owner/b4', '/@owner/b3', '/@owner/b2'],
    more: '2',
  })
})
