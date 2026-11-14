import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, communities, decks, events, eventTalks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedPublic,
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

const SPEAKER_ID = '999'
const PLAYER = 'https://speakerdeck.com/player/a5877da0f6d34490ac573c4aca5e7203'

let other = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await orm.insert(accounts).values([
    { user_id: OWNER_ID, handle: 'owner', created_at: 1 },
    { user_id: SPEAKER_ID, handle: 'speaker', created_at: 1 },
  ])
  await seedPublic(db, 'talk', 1, 'Talk')
  other = await seedPublic(db, 'other', 2, 'Other', SPEAKER_ID)
  await orm.insert(communities).values({
    id: 'kyotojs',
    name: 'Kyoto.js',
    url: 'https://kyotojs.example/',
  })
  await orm.insert(events).values({
    id: 'tokyotojs-03',
    community_id: 'kyotojs',
    name: 'ToKyoto.js #03',
    url: 'https://kyotojs.example/event/402321/',
    hashtag: 'kyotojs',
    held_on: '2026-09-03',
  })
})
afterAll(() => platform.dispose())

const present = (
  position: number,
  talk: Partial<typeof eventTalks.$inferInsert>,
  event = 'tokyotojs-03',
) => orm.insert(eventTalks).values({ event_id: event, position, ...talk })

const view = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

const frameSources = (response: Response) =>
  /frame-src ([^;]*)/
    .exec(response.headers.get('Content-Security-Policy') ?? '')?.[1]
    ?.split(' ')

test('Given a deck presented at an event, When opened, Then the community, the event, its date and its hashtag show beside the author', async () => {
  await present(1, { deck_id: 'talk' })

  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain(
    '<a href="https://kyotojs.example/" target="_blank" rel="noopener noreferrer">Kyoto.js</a>',
  )
  expect(page).toContain(
    '<a href="https://kyotojs.example/event/402321/" target="_blank" rel="noopener noreferrer">ToKyoto.js #03</a>',
  )
  expect(page).toMatch(/<time datetime="2026-09-03"\s*>2026年9月3日<\/time/)
  expect(page).toContain(
    '<a href="https://x.com/hashtag/kyotojs" target="_blank" rel="noopener noreferrer">#kyotojs</a>',
  )
  // Alone at its event, the deck has no other talks to show.
  expect(page).not.toContain('のほかの発表')
})

test('Given other talks at the event, When the deck is opened, Then they run under it in the event’s order, a deck here in a sandboxed frame and slides elsewhere in their player', async () => {
  await present(1, {
    title: 'V8',
    speaker: 'did0es',
    url: 'https://speakerdeck.com/shuta13/v8',
    embed_url: PLAYER,
  })
  await present(2, { deck_id: 'talk' })
  await present(3, { deck_id: 'other' })

  const response = await view('/@owner/talk')
  const page = await response.text()

  const section = page.slice(page.indexOf('ToKyoto.js #03 のほかの発表'))
  expect(section.indexOf(`src="${PLAYER}"`)).toBeGreaterThan(0)
  expect(section.indexOf('href="/@speaker/other"')).toBeGreaterThan(
    section.indexOf(`src="${PLAYER}"`),
  )
  expect(section).toMatch(
    new RegExp(
      `<iframe\\s+data-deck\\s+src="https://d-${other}\\.content\\.example/"\\s+title="Other"\\s+loading="lazy"\\s+sandbox="allow-scripts allow-same-origin"`,
    ),
  )
  expect(section).toContain(
    '<a href="https://speakerdeck.com/shuta13/v8" target="_blank" rel="noopener noreferrer">V8</a>',
  )
  expect(section).toContain('<small>did0es</small>')
  // The deck itself is not among the other talks.
  expect(section).not.toContain('href="/@owner/talk"')
  // In the event's order: the player first, then the deck here.
  expect(frameSources(response)).toEqual([
    expect.stringMatching(/^https:\/\/d-.+\.content\.example$/),
    "'self'",
    'https://speakerdeck.com',
    `https://d-${other}.content.example`,
  ])
})

test('Given slides elsewhere whose player is not a known one, When the deck is opened, Then the talk is a link and nothing more is framed', async () => {
  await present(1, { deck_id: 'talk' })
  await present(2, {
    title: 'Elsewhere',
    url: 'https://slides.example/talk',
    embed_url: 'https://slides.example/embed/1',
  })

  const response = await view('/@owner/talk')
  const page = await response.text()

  expect(page).toContain('>Elsewhere</a>')
  expect(page).not.toContain('slides.example/embed')
  expect(frameSources(response)).toHaveLength(2)
})

test('Given another talk that is a draft, a stopped deck, or has an unsafe link, When the deck is opened, Then nothing tells of it', async () => {
  await seedDeck(db, 'draft')
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'other'))
  await present(1, { deck_id: 'talk' })
  await present(2, { deck_id: 'draft' })
  await present(3, { deck_id: 'other' })
  await present(4, { title: 'Bad', url: 'javascript:alert(1)' })

  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain('ToKyoto.js #03')
  expect(page).not.toContain('のほかの発表')
  expect(page).not.toContain('draft')
  expect(page).not.toContain('Bad')
})

test('Given more talks than are shown, When the deck is opened, Then the first few show and the rest are counted', async () => {
  await present(1, { deck_id: 'talk' })
  for (const position of [2, 3, 4, 5, 6, 7])
    await present(position, {
      title: `T${position}`,
      url: `https://slides.example/${position}`,
    })

  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain('>T5</a>')
  expect(page).not.toContain('>T6</a>')
  expect(page).toContain('ほか 2 件')
})

test('Given a deck presented twice, When opened, Then the later event comes first', async () => {
  await orm.insert(events).values({
    id: 'again',
    community_id: 'kyotojs',
    name: 'Encore',
    url: 'https://kyotojs.example/event/2/',
    hashtag: null,
    held_on: '2026-10-01',
  })
  await present(1, { deck_id: 'talk' })
  await present(1, { deck_id: 'talk' }, 'again')

  const page = await (await view('/@owner/talk')).text()

  expect(page.indexOf('>Encore</a>')).toBeGreaterThan(0)
  expect(page.indexOf('>ToKyoto.js #03</a>')).toBeGreaterThan(
    page.indexOf('>Encore</a>'),
  )
})

test.each([
  ['a script link', { url: 'javascript:alert(1)' }],
  ['a date that is not a date', { held_on: 'soon' }],
])(
  'Given an event stored with %s, When the deck is opened, Then the event is not shown',
  async (_, fields) => {
    await orm.update(events).set(fields).where(eq(events.id, 'tokyotojs-03'))
    await present(1, { deck_id: 'talk' })

    const response = await view('/@owner/talk')

    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('class="events"')
  },
)

test('Given an event stored with a hashtag that is not one, When the deck is opened, Then the event shows without it', async () => {
  await orm
    .update(events)
    .set({ hashtag: 'a"><script>' })
    .where(eq(events.id, 'tokyotojs-03'))
  await present(1, { deck_id: 'talk' })

  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain('>ToKyoto.js #03</a>')
  expect(page).not.toContain('x.com/hashtag')
})

test('Given a deck at no event, When opened, Then the viewer is as before', async () => {
  const response = await view('/@owner/talk')
  const page = await response.text()

  expect(page).not.toContain('class="events"')
  expect(frameSources(response)).toHaveLength(2)
})
