import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { saveCitations } from '../citations/store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { blocks, decks, mutes } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { eq } from 'drizzle-orm'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const EVENT = 'https://kanagawapm.connpass.com/event/410635/'
const OTHER_EVENT = 'https://kanagawapm.connpass.com/event/500/'

let owner = ''
let talkDeployment = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  // Signing in records the handles `owner` and `bob` that share URLs carry.
  owner = await signIn(env)
  await signIn(env, 'bob', { id: INVITED_ID })
  talkDeployment = await seedPublic(db, 'talk', 100, 'Talk')
  await seedTalkLink(db, {
    deckId: 'talk',
    url: EVENT,
    title: 'Kanagawa.pm #3',
  })
})
afterAll(() => platform.dispose())

const withCommunity = () =>
  seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })

/** A public deck given as a talk of `url`, published at `at`. */
async function talkOf(
  url: string,
  deck: string,
  at: number,
  author = OWNER_ID,
) {
  await seedPublic(db, deck, at, deck, author)
  await seedTalkLink(db, { deckId: deck, url, owner: author })
}

const viewer = async (cookie = '') =>
  (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/@owner/talk`, {
          headers: cookie ? { Cookie: cookie } : {},
        }),
        env,
      )
    ).text()
  )
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
    .replace(/ </g, '<')

/** The decks a section links, in order; null when the section is not drawn. */
function section(page: string, name: 'same-event' | 'same-community') {
  const start = page.indexOf(`<div data-reader-lists="${name}">`)
  expect(start).toBeGreaterThan(0)
  const rest = page.slice(start)
  if (rest.startsWith(`<div data-reader-lists="${name}"></div>`)) return null
  const body = rest.slice(0, rest.indexOf('</section>'))
  return [...body.matchAll(/class="card-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )
}

const decksOf = (...names: string[]) => names.map((name) => `/@owner/${name}`)

test('F24-AC38: Given four other talks of the same event, When the viewer opens, Then both the event’s section and the community’s section stand', async () => {
  await withCommunity()
  for (const [index, deck] of ['e1', 'e2', 'e3', 'e4'].entries())
    await talkOf(EVENT, deck, 200 + index)
  await talkOf(OTHER_EVENT, 'o1', 300)
  const page = await viewer()
  expect(section(page, 'same-event')).toEqual(decksOf('e4', 'e3', 'e2', 'e1'))
  expect(section(page, 'same-community')).toEqual(decksOf('o1'))
  expect(page).toContain('<h2 id="same-event">Kanagawa.pm #3 のほかの発表</h2>')
  expect(page).toContain(
    '<h2 id="same-community">Kanagawa.pm のほかのイベントの発表</h2>',
  )
})

test('F24-AC39: Given three other talks of the same event, When the viewer opens, Then only the community’s section stands, the same event’s talks first', async () => {
  await withCommunity()
  for (const [index, deck] of ['e1', 'e2', 'e3'].entries())
    await talkOf(EVENT, deck, 200 + index)
  // Newer than the event's talks, yet it comes after them.
  await talkOf(OTHER_EVENT, 'o1', 900)
  const page = await viewer()
  expect(section(page, 'same-event')).toBeNull()
  expect(page).not.toContain('のほかの発表</h2>')
  expect(section(page, 'same-community')).toEqual(
    decksOf('e3', 'e2', 'e1', 'o1'),
  )
})

test('F24-AC40: Given an event in no community, When the viewer opens, Then the event’s section alone stands, even with fewer than four talks', async () => {
  await talkOf(EVENT, 'e1', 200)
  const page = await viewer()
  expect(section(page, 'same-event')).toEqual(decksOf('e1'))
  expect(section(page, 'same-community')).toBeNull()
})

test('F24-AC41: Given a community with no other public talk, When the viewer opens, Then neither section is drawn, heading included', async () => {
  await withCommunity()
  const page = await viewer()
  expect(section(page, 'same-event')).toBeNull()
  expect(section(page, 'same-community')).toBeNull()
  expect(page).not.toContain('のほかのイベントの発表')
})

test('F24-AC41: Given ten other talks of the same event and ten of another, When the viewer opens, Then each section holds eight', async () => {
  await withCommunity()
  for (let index = 0; index < 10; index++) {
    await talkOf(EVENT, `e${index}`, 200 + index)
    await talkOf(OTHER_EVENT, `o${index}`, 400 + index)
  }
  const page = await viewer()
  expect(section(page, 'same-event')).toHaveLength(8)
  expect(section(page, 'same-community')).toHaveLength(8)
})

test('F24-AC42: Given talks that are not public, taken down, or by a person the reader blocked, When the reader opens the viewer, Then the sections leave them out and the slides viewed too', async () => {
  await talkOf(EVENT, 'public', 200)
  await talkOf(EVENT, 'blocked', 210, INVITED_ID)
  await talkOf(EVENT, 'hidden', 220)
  await orm.update(decks).set({ hidden_at: 1 }).where(eq(decks.id, 'hidden'))
  await seedDeck(db, 'draft')
  await seedTalkLink(db, { deckId: 'draft', url: EVENT })
  await orm.insert(blocks).values({
    blocker_user_id: OWNER_ID,
    blocked_user_id: INVITED_ID,
    created_at: 1,
  })
  expect(section(await viewer(owner), 'same-event')).toEqual(decksOf('public'))
  // Signed out, no block applies.
  expect(section(await viewer(), 'same-event')).toEqual([
    '/@bob/blocked',
    '/@owner/public',
  ])
})

test('F24-AC42: Given a talk by a person the reader muted, When the reader opens the viewer, Then the sections leave it out', async () => {
  await talkOf(EVENT, 'muted', 200, INVITED_ID)
  await orm.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: INVITED_ID,
    created_at: 1,
  })
  expect(section(await viewer(owner), 'same-event')).toBeNull()
})

test('F24-AC43: Given a talk the slides cite, and one in two of the community’s events, When the viewer opens, Then each shows once', async () => {
  await withCommunity()
  for (const [index, deck] of ['e1', 'e2', 'e3', 'e4'].entries())
    await talkOf(EVENT, deck, 200 + index)
  // e4 is cited by the slides viewed: it stays on the citations alone.
  await saveCitations(db, talkDeployment, [
    { handle: 'owner', slug: 'e4', page: 0 },
  ])
  // e1 is a talk of the other event too: it stays in the event's section.
  await seedTalkLink(db, { deckId: 'e1', url: OTHER_EVENT })
  const page = await viewer()
  expect(page.match(/class="card-title" href="\/@owner\/e4"/g)).toHaveLength(1)
  expect(section(page, 'same-event')).toEqual(decksOf('e3', 'e2', 'e1'))
  expect(section(page, 'same-community')).toBeNull()
})

test('F24-AC44: Given slides in two events, When the viewer opens, Then the event added first decides the sections', async () => {
  await talkOf('https://perl.connpass.com/event/9/', 'later', 200)
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://perl.connpass.com/event/9/',
  })
  await talkOf(EVENT, 'first', 210)
  const page = await viewer()
  expect(section(page, 'same-event')).toEqual(decksOf('first'))
  expect(page).toContain('Kanagawa.pm #3 のほかの発表')
})

test('F24-AC45: Given both sections, When the viewer opens, Then “イベントを見る” and “コミュニティを見る” stand beside their headings', async () => {
  await withCommunity()
  for (const [index, deck] of ['e1', 'e2', 'e3', 'e4'].entries())
    await talkOf(EVENT, deck, 200 + index)
  await talkOf(OTHER_EVENT, 'o1', 300)
  const page = await viewer()
  expect(page).toMatch(
    /<h2 id="same-event">[^<]+<\/h2><a href="\/events\/\d+">イベントを見る<\/a>/,
  )
  expect(page).toContain(
    '<h2 id="same-community">Kanagawa.pm のほかのイベントの発表</h2><a href="/@kanagawapm">コミュニティを見る</a>',
  )
})
