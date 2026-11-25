import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { markAccountDeleted, markDeckDeleted } from '../decks/deletion-store'
import { relatedLinks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { MAX_LINKS } from './link'
import { addLink, listLinks, removeLink } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let other = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  other = await signIn(env, 'other', { id: '2' })
})
afterAll(() => platform.dispose())

const form = (path: string, cookie: string, fields: Record<string, string>) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
const text = async (response: Response | Promise<Response>) =>
  (await (await response).text()).replace(/\s+/g, ' ')

const add = (
  fields: Partial<Record<'kind' | 'url' | 'title', string>> = {},
  cookie = owner,
  deck = 'talk',
) =>
  form(`/slides/${deck}/links`, cookie, {
    kind: 'video',
    url: 'https://youtube.com/watch?v=1',
    title: 'The recording',
    ...fields,
  })
const rows = () => orm.select().from(relatedLinks).all()
test('F27-AC1: Given the author of a deck, When they add a link of each kind, Then it is saved and the page goes back to the deck', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (const kind of ['video', 'article', 'other']) {
    const response = await add({
      kind,
      title: kind,
      url: `https://example.com/${kind}`,
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/slides/talk#links')
  }
  expect((await rows()).map((row) => row.kind)).toEqual([
    'video',
    'article',
    'other',
  ])
})

test('F27-AC48: Given an address written in another form, When it is added, Then the link keeps it as parsed and the form it is compared in', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://WWW.YouTube.com/watch?feature=share&v=abc#t' })
  expect((await rows()).map((row) => [row.url, row.normalized_url])).toEqual([
    [
      'https://www.youtube.com/watch?feature=share&v=abc#t',
      'https://youtube.com/watch?v=abc',
    ],
  ])
})

test('F27-AC4: Given a link, When the author removes it, Then the deck page and the viewer no longer show it', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const [link] = await listLinks(db, 'talk')
  const removed = await form(`/slides/talk/links/${link?.id}/delete`, owner, {})
  expect(removed.status).toBe(303)
  expect(await rows()).toEqual([])
  expect(await text(get('/slides/talk', owner))).not.toContain('The recording')
})

test.each([
  ['http://example.com/'],
  ['javascript:alert(1)'],
  ['data:text/html,x'],
])(
  'F27-AC5: Given the URL %s, When it is added, Then nothing is saved and the page says why',
  async (url) => {
    await seedPublic(db, 'talk', 100, 'Talk')
    const response = await add({ url })
    expect(response.headers.get('Location')).toBe(
      '/slides/talk?links=url_scheme#links',
    )
    expect(await rows()).toEqual([])
    const page = await text(get('/slides/talk?links=url_scheme', owner))
    expect(page).toContain('role="alert"')
    expect(page).toContain('https:// で始まる URL だけ使えます。')
  },
)

test('F27-AC7: Given a title of 100 characters and one of 101, When they are added, Then only the first is saved', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  expect((await add({ title: 'あ'.repeat(100) })).headers.get('Location')).toBe(
    '/slides/talk#links',
  )
  const long = await add({ title: 'あ'.repeat(101) })
  expect(long.headers.get('Location')).toContain('links=title_too_long')
  expect(await rows()).toHaveLength(1)
  expect(await text(get('/slides/talk?links=title_too_long', owner))).toContain(
    '題名は 100 文字までにしてください。',
  )
})

test('F27-AC8: Given 10 links, When an 11th is added, Then it is refused with the reason, and removing one makes room', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (let n = 1; n <= MAX_LINKS; n++)
    await add({ title: `Link ${n}`, url: `https://example.com/${n}` })
  expect(await rows()).toHaveLength(10)
  const eleventh = await add({
    title: 'Link 11',
    url: 'https://example.com/11',
  })
  expect(eleventh.headers.get('Location')).toBe('/slides/talk?links=full#links')
  expect(await rows()).toHaveLength(10)
  expect(await text(get('/slides/talk?links=full', owner))).toContain(
    '関連リンクは 10 件までです。',
  )
  const [first] = await listLinks(db, 'talk')
  await form(`/slides/talk/links/${first?.id}/delete`, owner, {})
  await add({ title: 'Link 11', url: 'https://example.com/11' })
  expect(await rows()).toHaveLength(10)
}, 30000)

test('F27-AC8: Given 10 links, When two more are added at once, Then the limit still holds', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (let n = 1; n < MAX_LINKS; n++)
    await add({ title: `Link ${n}`, url: `https://example.com/${n}` })
  const link = {
    kind: 'other',
    url: 'https://example.com/',
    title: 'Race',
  } as const
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      addLink(db, { deckId: 'talk', ownerUserId: OWNER_ID, link, now: 1 }),
    ),
  )
  expect(results.filter((result) => result === 'added')).toHaveLength(1)
  expect(await rows()).toHaveLength(10)
}, 30000)

test('F27-AC13: Given another author, When they add or remove a link of a deck that is not theirs, Then nothing changes and the answer is the one for a deck that does not exist', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const [link] = await listLinks(db, 'talk')
  const foreign = await add({ title: 'Mine now' }, other)
  const unknown = await add({ title: 'Mine now' }, other, 'nothing-here')
  expect(foreign.status).toBe(404)
  expect(unknown.status).toBe(404)
  // Only the language link echoes the path that was asked for.
  const sameAs = (body: string) => body.replace(/\/slides\/[^/]+\/links/g, '')
  expect(sameAs(await foreign.text())).toBe(sameAs(await unknown.text()))
  const removal = await form(`/slides/talk/links/${link?.id}/delete`, other, {})
  expect(removal.status).toBe(404)
  expect(
    await removeLink(db, {
      deckId: 'talk',
      ownerUserId: '2',
      linkId: link?.id ?? '',
    }),
  ).toBe('missing')
  expect(
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: '2',
      link: { kind: 'other', url: 'https://example.com/', title: 'x' },
      now: 1,
    }),
  ).toBe('missing')
  expect((await rows()).map((row) => row.title)).toEqual(['The recording'])
})

test('F27-AC13: Given a signed-out visitor, When they post a link, Then it is refused and nothing is saved', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const response = await add({}, '')
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(await rows()).toEqual([])
})

test('F27-AC15: Given the deck page, When it is opened in each language, Then the drop zone says the article and the related links stay', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  expect(await text(get('/slides/talk', owner))).toContain(
    '記事と関連リンクも残ります。',
  )
  expect(await text(get('/slides/talk?lang=en', owner))).toContain(
    'The article and related links stay too.',
  )
})

test('F27-AC18: Given two decks with links, When one is deleted, Then its links are gone and the other deck keeps its own', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedPublic(db, 'slides', 100, 'Slides')
  await add()
  await add({ title: 'Kept' }, owner, 'slides')
  const response = await form('/slides/talk/delete', owner, { confirm: 'talk' })
  expect(response.status).toBe(303)
  expect((await rows()).map((row) => row.deck_id)).toEqual(['slides'])
  expect(
    await markDeckDeleted(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      now: 1,
    }),
  ).toBe('deleted')
})

test('F27-AC19: Given an author with links on two decks and another author with one, When the author leaves, Then only the other author keeps their link', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedPublic(db, 'slides', 100, 'Slides')
  await seedPublic(db, 'theirs', 100, 'Theirs', '2')
  await add()
  await add({}, owner, 'slides')
  await add({ title: 'Theirs' }, other, 'theirs')
  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 1 })
  expect((await rows()).map((row) => row.deck_id)).toEqual(['theirs'])
})

test('F27-AC44: Given a deck with a link, When the author adds the same address again with another title, Then it is refused, the page says so in each language, and the deck keeps one link', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const again = await add({ title: 'Another title' })
  expect(again.status).toBe(303)
  expect(again.headers.get('Location')).toBe(
    '/slides/talk?links=duplicate#links',
  )
  expect((await rows()).map((row) => row.title)).toEqual(['The recording'])
  const page = await text(get('/slides/talk?links=duplicate', owner))
  expect(page).toContain(
    '<p class="notice-danger" role="alert"> すでに足してあります。 </p>',
  )
  expect(
    await text(get('/slides/talk?links=duplicate&lang=en', owner)),
  ).toContain('This link is already on the slides.')
})

test('F27-AC44: Given a deck, When one address is added three times at once, Then the deck keeps it once and the others are told it is there', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const link = {
    kind: 'other',
    url: 'https://example.com/a',
    title: null,
  } as const
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      addLink(db, { deckId: 'talk', ownerUserId: OWNER_ID, link, now: 1 }),
    ),
  )
  expect([...results].sort()).toEqual(['added', 'duplicate', 'duplicate'])
  expect(await rows()).toHaveLength(1)
})

test('F27-AC45: Given another deck with a link, When the same address is added to this deck, Then it is added', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedPublic(db, 'slides', 100, 'Slides')
  await add({}, owner, 'slides')
  expect((await add()).headers.get('Location')).toBe('/slides/talk#links')
  expect((await rows()).map((row) => row.deck_id).sort()).toEqual([
    'slides',
    'talk',
  ])
})

test('F27-AC46: Given a link that was removed, When its address is added again, Then it is added', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const [link] = await listLinks(db, 'talk')
  await form(`/slides/talk/links/${link?.id}/delete`, owner, {})
  expect(
    (await add({ url: 'https://youtu.be/1' })).headers.get('Location'),
  ).toBe('/slides/talk#links')
  expect(await rows()).toHaveLength(1)
})

test('F27-AC48: Given a link, When an address written otherwise but of the same form is added, Then it is refused, and one of another form is added', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://m.youtube.com/watch?v=abc' })
  for (const url of [
    'https://youtu.be/abc?si=x',
    'https://www.youtube.com/shorts/abc/',
    'https://www.youtube.com/watch?v=abc&utm_source=x#t',
  ])
    expect((await add({ url })).headers.get('Location')).toBe(
      '/slides/talk?links=duplicate#links',
    )
  expect(
    (await add({ url: 'https://youtu.be/abc?t=30' })).headers.get('Location'),
  ).toBe('/slides/talk#links')
  expect(await rows()).toHaveLength(2)
})

test('F27-AC49: Given 10 links, When an address of the same form as one of them is added, Then the reason is that it is there already, not the limit', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (let n = 1; n <= MAX_LINKS; n++)
    await add({ url: `https://example.com/${n}` })
  const again = await add({ url: 'https://www.example.com/3/' })
  expect(again.headers.get('Location')).toBe(
    '/slides/talk?links=duplicate#links',
  )
  expect(
    (await add({ url: 'https://example.com/11' })).headers.get('Location'),
  ).toBe('/slides/talk?links=full#links')
  expect(await rows()).toHaveLength(MAX_LINKS)
}, 30000)

test('F27-AC13: Given another author’s deck with a link, When the same address is added to it, Then the answer is the one for a deck that does not exist', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  expect((await add({}, other)).status).toBe(404)
  expect(
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: '2',
      link: {
        kind: 'video',
        url: 'https://youtube.com/watch?v=1',
        title: null,
      },
      now: 1,
    }),
  ).toBe('missing')
  expect(await rows()).toHaveLength(1)
})
