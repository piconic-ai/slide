import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  accounts,
  citations,
  decks,
  deployments,
  mutes,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { PAIRS_PER_PAGE } from './pair-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = testEnv(platform.env)
let alice = ''

/** The deployment each seeded deck serves, by deck name. */
const version: Record<string, string> = {}

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice', { name: 'Alice Liddell' })
  await signIn(env, 'bob', { id: INVITED_ID, name: 'Bob Builder' })
  await signIn(env, 'carol', { id: CAROL_ID })
  version.keynote = await seedPublic(database, 'keynote', 1, 'Alice’s keynote')
  version.reply = await seedPublic(
    database,
    'reply',
    1763510400,
    'Bob’s reply',
    INVITED_ID,
  )
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const cite = (from: string, handle: string, slug: string, page = 0) =>
  db.insert(citations).values({
    deployment_id: version[from]!,
    target_handle: handle,
    target_slug: slug,
    target_page: page,
  })

/** The decks a page's rows lead to, in order. */
const rows = (page: string) =>
  [...page.matchAll(/<a class="citation-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )

/** The count beside a profile's tab, where the numbers stand. */
const statCount = (page: string, label: string) =>
  page.match(new RegExp(`>${label} <span class="count">(\\d+)</span`))?.[1]

test('F24-AC22, F24-AC31: Given Bob’s deck cites Alice’s, When a visitor who is not signed in opens Alice’s cited list, Then the row has Bob’s cover, his name and title, the line naming Alice’s deck and the day', async () => {
  await cite('reply', 'alice', 'keynote', 3)

  const response = await get('/@alice/cited')

  expect(response.status).toBe(200)
  const page = await response.text()
  expect(rows(page)).toEqual(['/@bob/reply'])
  expect(page).toContain('<title>引用された - @alice - slide.community</title>')
  expect(page).toContain('<strong>Bob Builderさん</strong>')
  expect(page).toContain('この人の『Alice’s keynote』を引用')
  expect(page).toContain('<time datetime="2025-11-19T00:00:00.000Z"')
  expect(page).toContain('2025年11月19日')
  expect(page).toContain('class="deck-cover"')
  expect(page).toContain('aria-current="page"')
})

test('F24-AC23, F24-AC31: Given Bob’s deck cites Alice’s, When a visitor who is not signed in opens Bob’s citing list, Then the row is Alice’s deck', async () => {
  await cite('reply', 'alice', 'keynote')

  const response = await get('/@bob/citing')

  expect(response.status).toBe(200)
  const page = await response.text()
  expect(rows(page)).toEqual(['/@alice/keynote'])
  expect(page).toContain('この人の『Bob’s reply』が引用')
  expect(page).toContain('<title>引用した - @bob - slide.community</title>')
})

test('F24-AC24: Given a deck citing another at two pages, When the cited list and the head are read, Then there is one row and the number is 1', async () => {
  await cite('reply', 'alice', 'keynote', 1)
  await cite('reply', 'alice', 'keynote', 2)

  const page = await (await get('/@alice/cited')).text()

  expect(rows(page)).toEqual(['/@bob/reply'])
  expect(statCount(page, '引用された')).toBe('1')
})

test('F24-AC25: Given Alice’s two decks citing each other, When her lists are opened, Then no row and no count shows', async () => {
  version.second = await seedPublic(database, 'second', 2, 'Second')
  await cite('second', 'alice', 'keynote')

  for (const list of ['cited', 'citing']) {
    const page = await (await get(`/@alice/${list}`)).text()
    expect(rows(page)).toEqual([])
    expect(statCount(page, '引用された')).toBe('0')
    expect(statCount(page, '引用した')).toBe('0')
  }
})

test('F24-AC26: Given Bob stops publishing his citing deck, When Alice’s cited list is opened, Then the row and the count are gone', async () => {
  await cite('reply', 'alice', 'keynote')
  expect(statCount(await (await get('/@alice')).text(), '引用された')).toBe('1')
  await db
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'reply'))

  const page = await (await get('/@alice/cited')).text()

  expect(rows(page)).toEqual([])
  expect(statCount(page, '引用された')).toBe('0')
})

test('F24-AC27: Given Alice muted Bob, When she and a visitor open her cited list, Then only the visitor sees Bob’s row and the count', async () => {
  await cite('reply', 'alice', 'keynote')
  await db.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: INVITED_ID,
    created_at: 1,
  })

  const mine = await (await get('/@alice/cited', alice)).text()
  const visitor = await (await get('/@alice/cited')).text()

  expect(rows(mine)).toEqual([])
  expect(statCount(mine, '引用された')).toBe('0')
  expect(rows(visitor)).toEqual(['/@bob/reply'])
  expect(statCount(visitor, '引用された')).toBe('1')
})

test.each([
  [
    'an operator-hidden citing deck',
    () => db.update(decks).set({ hidden_at: 5 }).where(eq(decks.id, 'reply')),
  ],
  [
    'a suspended citing author',
    () =>
      db.insert(suspensions).values({
        user_id: INVITED_ID,
        reason: 'spam',
        suspended_at: 5,
        suspended_by: 'op',
      }),
  ],
])(
  'F24-AC28: Given %s, When Alice’s cited list is opened by anyone, Then the row is not there and the count leaves it out',
  async (_name, stop) => {
    await cite('reply', 'alice', 'keynote')
    await stop()

    const page = await (await get('/@alice/cited')).text()

    expect(rows(page)).toEqual([])
    expect(statCount(page, '引用された')).toBe('0')
  },
)

test('F24-AC29: Given two citing decks published on different days, When the cited list is opened, Then the newer pair is first', async () => {
  version.later = await seedPublic(
    database,
    'later',
    1763596800,
    'Later',
    CAROL_ID,
  )
  await cite('reply', 'alice', 'keynote')
  await cite('later', 'alice', 'keynote')

  const page = await (await get('/@alice/cited')).text()

  expect(rows(page)).toEqual(['/@carol/later', '/@bob/reply'])
})

test('F24-AC30: Given 51 pairs, When the list is opened, Then the first page has 50 newest and the second has the last one', async () => {
  const total = PAIRS_PER_PAGE + 1
  for (let n = 1; n <= total; n++) {
    version[`d${n}`] = await seedPublic(
      database,
      `d${n}`,
      100 + n,
      `D${n}`,
      CAROL_ID,
    )
    await cite(`d${n}`, 'alice', 'keynote')
  }

  const first = await (await get('/@alice/cited')).text()
  const second = await (await get('/@alice/cited?page=2')).text()

  expect(rows(first)).toHaveLength(PAIRS_PER_PAGE)
  expect(rows(first)[0]).toBe('/@carol/d51')
  expect(first).toMatch(
    /<a\s+rel="next"\s+href="\/@alice\/cited\?page=2"\s*>次の 50 件<\/a\s*>/,
  )
  expect(rows(second)).toEqual(['/@carol/d1'])
  expect(second).toMatch(/rel="prev"/)
  expect(statCount(first, '引用された')).toBe(String(total))
}, 60_000)

test.each(['0', '-1', 'abc', '1.5'])(
  'F24-AC30: Given the page %j, When a citation list is opened, Then the profile’s 404 answers',
  async (page) => {
    expect((await get(`/@alice/cited?page=${page}`)).status).toBe(404)
  },
)

test('F24-AC30: Given a page past the end, When the list is opened, Then it says nothing is there and leads back', async () => {
  await cite('reply', 'alice', 'keynote')

  const page = await (await get('/@alice/cited?page=3')).text()

  expect(rows(page)).toEqual([])
  expect(page).toContain('このページには、引用がありません。')
})

test.each(['cited', 'citing'])(
  'F24-AC32: Given a handle nobody holds and a suspended author, When their %s list is opened, Then both answer the profile’s 404',
  async (list) => {
    const missing = await get(`/@nobody/${list}`)
    const profile = await get('/@nobody')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe(
      (await profile.text()).replaceAll('/@nobody', `/@nobody/${list}`),
    )
    await db.insert(suspensions).values({
      user_id: INVITED_ID,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    const suspended = await get(`/@bob/${list}`)
    expect(suspended.status).toBe(404)
    expect(await suspended.text()).not.toContain('Bob Builder')
  },
)

test.each(['cited', 'citing'])(
  'F24-AC35: Given a public deck somehow named %s, When the path of that name under its author’s handle is opened, Then the list opens, not the deck',
  async (name) => {
    // The names are reserved, so only a row written past the rule holds one.
    await seedPublic(database, 'squatter', 5, 'Squatter', CAROL_ID, name)

    const response = await get(`/@carol/${name}`)

    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).not.toContain('id="deck"')
    expect(page).toContain(
      `<title>${name === 'cited' ? '引用された' : '引用した'} - @carol - slide.community</title>`,
    )
  },
)

test.each([
  ['/@Alice/Cited', '/@alice/cited'],
  ['/@alice/citing/', '/@alice/citing'],
  ['/%40alice/CITED', '/@alice/cited'],
])(
  'F24-AC35: Given the spelling %s, When opened, Then it redirects to the canonical list',
  async (path, canonical) => {
    const response = await get(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(canonical)
  },
)

test('F24-AC22: Given the reader chose English, When a citation list is opened, Then its words are in English', async () => {
  await cite('reply', 'alice', 'keynote')

  const page = await (await get('/@alice/cited?lang=en')).text()

  expect(page).toContain('<title>Cited - @alice - slide.community</title>')
  expect(page).toContain('Cites this person’s “Alice’s keynote”')
  expect(page).toContain('<strong>Bob Builder</strong>')
  expect(await (await get('/@carol/cited?lang=en')).text()).toContain(
    'No slides have been cited yet.',
  )
})

test('F24-AC31: Given a citation list, When it is answered, Then nothing keeps it, since it is made of what its reader may see', async () => {
  const response = await get('/@alice/cited')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
})

test('F24-AC22: Given the cited deck has no title, When the cited list is opened, Then the line names it by its URL name, not an empty pair of brackets', async () => {
  await db
    .update(deployments)
    .set({ title: null })
    .where(eq(deployments.id, version.keynote!))
  await cite('reply', 'alice', 'keynote')

  const cited = await (await get('/@alice/cited')).text()
  const citing = await (await get('/@bob/citing')).text()

  expect(cited).toContain('この人の『keynote』を引用')
  expect(cited).not.toContain('『』')
  expect(citing).toContain(
    '<a class="citation-title" href="/@alice/keynote">keynote</a>',
  )
  await db
    .update(deployments)
    .set({ title: null })
    .where(eq(deployments.id, version.reply!))
  expect(await (await get('/@bob/citing')).text()).toContain(
    'この人の『reply』が引用',
  )
})

test('F24-AC33, F24-AC34: Given Bob’s deck cites Alice’s, When Alice’s profile is opened, Then her cited deck’s card says how many cite it and Bob’s card says nothing', async () => {
  await cite('reply', 'alice', 'keynote')
  version.other = await seedPublic(database, 'other', 3, 'Other')

  const alices = await (await get('/@alice')).text()
  const bobs = await (await get('/@bob')).text()

  const card = (page: string, slug: string) =>
    page.match(
      new RegExp(
        `<li class="deck-card">(?:(?!</li>).)*?/@\\w+/${slug}"(?:(?!</li>).)*</li>`,
        's',
      ),
    )?.[0] ?? ''
  expect(card(alices, 'keynote')).toContain(
    '<span class="card-cited">引用された 1 件</span>',
  )
  expect(card(alices, 'other')).not.toContain('card-cited')
  expect(bobs).not.toContain('card-cited')
  const english = await (await get('/@alice?lang=en')).text()
  expect(english).toContain('<span class="card-cited">Cited by 1</span>')
})

test('F24-AC33: Given Alice muted Bob, When she and a visitor open her profile, Then the count on her card leaves Bob out for her only', async () => {
  await cite('reply', 'alice', 'keynote')
  await db.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: INVITED_ID,
    created_at: 1,
  })

  expect(await (await get('/@alice', alice)).text()).not.toContain('card-cited')
  expect(await (await get('/@alice')).text()).toContain('card-cited')
})

test('F24-AC33, F24-AC34: Given Bob’s deck cites Alice’s, When the viewers of both and the top page’s recent slides are read, Then every card of a cited deck carries its count and the others none', async () => {
  await cite('reply', 'alice', 'keynote')

  const citedBy = await (await get('/@alice/keynote')).text()
  const cites = await (await get('/@bob/reply')).text()
  const recent = (await (await get('/api/public/slides')).json()) as {
    href: string
    citedBy: number
  }[]

  // Alice's viewer lists Bob's deck, which nobody cites.
  expect(citedBy).toContain('href="/@bob/reply"')
  expect(citedBy).not.toContain('card-cited')
  // Bob's viewer lists Alice's deck, which Bob's cites.
  expect(cites).toContain('<span class="card-cited">引用された 1 件</span>')
  expect(
    Object.fromEntries(recent.map((deck) => [deck.href, deck.citedBy])),
  ).toEqual({ '/@alice/keynote': 1, '/@bob/reply': 0 })
})

test('F24-AC33: Given a deck citing 100 authors’ decks, When its viewer is opened, Then it answers 200 and every cited deck’s card has its count', async () => {
  for (let n = 1; n <= 100; n++) {
    const id = String(8000 + n)
    await db
      .insert(accounts)
      .values({ user_id: id, handle: `a${n}`, created_at: 1 })
    version[`x${n}`] = await seedPublic(database, `x${n}`, 10, `X${n}`, id)
    await cite('keynote', `a${n}`, `x${n}`)
    await cite(`x${n}`, 'alice', 'keynote')
  }

  const response = await get('/@alice/keynote')

  expect(response.status).toBe(200)
  const page = await response.text()
  // Four cards on each side, each of a deck cited by one deck.
  expect(page.match(/card-cited">引用された 1 件/g)).toHaveLength(8)
}, 120_000)
