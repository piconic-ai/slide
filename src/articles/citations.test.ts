import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { readArticle } from './store'
import server from '../app/routes'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
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
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  reader = await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'talk', 1, 'Talk')
  await seedPublic(db, 'reply', 2, 'Reply', INVITED_ID)
})
afterAll(() => platform.dispose())

const send = async (
  cookie: string,
  deck: string,
  fields: Record<string, string>,
  path = '',
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/slides/${deck}/article${path}`, {
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
const publish = (body: string) =>
  send(reader, REPLY.deck, { action: 'publish', body })

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
  await send(reader, 'reply', { action: 'unpublish' })
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
  await send(owner, 'talk', {
    action: 'publish',
    body: `${TEST_ORIGIN}/@owner/talk/3 and [me](${TEST_ORIGIN}/@owner/talk)`,
  })
  expect(await citedBy()).toEqual([])
})

test('F24-AC21: Given an article of another of the author’s slides, When it links to the first, Then it counts, as links between one author’s slides do', async () => {
  await seedPublic(db, 'second', 3, 'Second')
  await send(owner, 'second', {
    action: 'publish',
    body: `${TEST_ORIGIN}/@owner/talk/2`,
  })
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
