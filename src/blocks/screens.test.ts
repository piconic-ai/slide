import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, blocks, follows, mutes } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const bobSlide = '/@bob/talk'
const aliceSlide = '/@alice/keynote'
const carolId = '999'
let alice = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  await db
    .insert(accounts)
    .values({ user_id: carolId, handle: 'carol', created_at: 1 })
  await seedPublic(database, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
})
beforeEach(async () => {
  await db.batch([db.delete(blocks), db.delete(follows), db.delete(mutes)])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const page = async (path: string, cookie = alice) => {
  const response = await get(path, cookie)
  expect(response.status).toBe(200)
  return response.text()
}

const aliceBlocksBob = () =>
  db.insert(blocks).values({
    blocker_user_id: OWNER_ID,
    blocked_user_id: INVITED_ID,
    created_at: 10,
  })

const viewerMenu = (html: string) =>
  /<details class="action-menu more-menu" data-menu>([\s\S]*?)<\/details>/.exec(
    html,
  )?.[1] ?? ''

const profileMenu = (html: string) =>
  /<details class="action-menu profile-menu" data-menu>([\s\S]*?)<\/details>/.exec(
    html,
  )?.[1] ?? ''

const hrefOf = (html: string) =>
  /href="(\/blocks\/new\?[^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&')

test.each([
  ['ja', 'この作者をブロック', 'この人をブロック'],
  ['en', 'Block this author', 'Block this person'],
])(
  'F32-AC14: Given Alice reads Bob’s slides and profile in %s, When she opens each ⋯ menu, Then it offers to block him through the confirmation page',
  async (lang, onSlides, onProfile) => {
    const slides = viewerMenu(await page(`${bobSlide}?lang=${lang}`))
    expect(slides).toMatch(new RegExp(`>\\s*${onSlides}\\s*</a\\s*>`))
    expect(hrefOf(slides)).toBe(
      `/blocks/new?${new URLSearchParams({ handle: 'bob', slide: bobSlide })}`,
    )
    expect(slides.indexOf('/blocks/new')).toBeGreaterThan(
      slides.indexOf('/mutes/new'),
    )

    const profile = profileMenu(await page(`/@bob?lang=${lang}`))
    expect(profile).toMatch(new RegExp(`>\\s*${onProfile}\\s*</a\\s*>`))
    expect(hrefOf(profile)).toBe(
      `/blocks/new?${new URLSearchParams({ handle: 'bob', slide: '/@bob' })}`,
    )
  },
)

test('F32-AC11: Given Alice on her own slides and profile, When the pages are read, Then neither offers to block', async () => {
  expect(await page(aliceSlide)).not.toContain('/blocks/new')
  expect(await page('/@alice')).not.toContain('/blocks/new')
})

test('F32-AC12: Given a reader who is not signed in, When they read Bob’s slides and profile, Then neither offers to block', async () => {
  expect(await page(bobSlide, '')).not.toContain('/blocks/new')
  expect(await page('/@bob', '')).not.toContain('/blocks/new')
})

test.each([
  ['ja', 'この人はフォローできません。'],
  ['en', 'You can’t follow this person.'],
])(
  'F32-AC2: Given Alice blocked Bob, When Bob opens Alice’s profile in %s, Then the follow button is disabled with only the line saying he cannot follow',
  async (lang, refused) => {
    await aliceBlocksBob()

    const html = await page(`/@alice?lang=${lang}`, bob)

    const button = /<button\b[^>]*aria-describedby="follow-refused"[^>]*>/.exec(
      html,
    )?.[0]
    expect(button).toMatch(/\sdisabled(?:[\s=>])/)
    expect(html).toContain(
      `<p class="field-note" id="follow-refused">${refused}</p>`,
    )
    expect(html).not.toContain('action="/follows"')
  },
)

test('F32-AC2, F32-AC8: Given Alice blocked Bob, When Bob opens the follow page for her, Then it says only that he cannot follow', async () => {
  await aliceBlocksBob()

  const html = await page(
    `/follows/new?${new URLSearchParams({ handle: 'alice', slide: aliceSlide })}`,
    bob,
  )

  expect(html).toContain('<p>この人はフォローできません。</p>')
  expect(html).not.toContain('action="/follows"')
  expect(html).not.toMatch(/ブロックされ|blocked/i)
})

test.each([
  ['ja', 'この人はフォローできません。'],
  ['en', 'You can’t follow this person.'],
])(
  'F32-AC2: Given Alice blocked Bob, When Alice opens Bob’s profile in %s, Then the follow button is disabled with the same line as Bob sees',
  async (lang, refused) => {
    await aliceBlocksBob()

    const html = await page(`/@bob?lang=${lang}`, alice)

    const button = /<button\b[^>]*aria-describedby="follow-refused"[^>]*>/.exec(
      html,
    )?.[0]
    expect(button).toMatch(/\sdisabled(?:[\s=>])/)
    expect(html).toContain(
      `<p class="field-note" id="follow-refused">${refused}</p>`,
    )
    expect(html).not.toContain('action="/follows"')
  },
)

test('F32-AC2: Given Alice blocked Bob, When Alice opens the follow page for him, Then it says only that she cannot follow', async () => {
  await aliceBlocksBob()

  const html = await page(
    `/follows/new?${new URLSearchParams({ handle: 'bob', slide: bobSlide })}`,
    alice,
  )

  expect(html).toContain('<p>この人はフォローできません。</p>')
  expect(html).not.toContain('action="/follows"')
})

async function bobsResponses() {
  const paths = [
    bobSlide,
    aliceSlide,
    '/@bob',
    '/settings',
    '/notifications',
    '/api/home',
  ]
  return Promise.all(
    paths.map(async (path) => {
      const response = await get(path, bob)
      return {
        path,
        status: response.status,
        body: await response.text(),
      }
    }),
  )
}

test('F32-AC8: Given Bob can see both slides, his profile, settings, notifications and top, When Alice blocks him, Then all of them stay the same, and Alice’s profile only changes its follow button', async () => {
  const before = await bobsResponses()
  const profileBefore = await page('/@alice', bob)

  await aliceBlocksBob()

  expect(await bobsResponses()).toEqual(before)
  const profileAfter = await page('/@alice', bob)
  expect(profileAfter).not.toBe(profileBefore)
  for (const text of [profileAfter, ...before.map((r) => r.body)])
    expect(text).not.toMatch(
      /ブロックされ|ブロック中|you(?:’|')?ve been blocked/i,
    )
  // What remains of the change is the follow button and its line alone.
  const head = (html: string) =>
    html
      .replace(/<div class="follow-refused">[\s\S]*?<\/div>/, '')
      .replace(/<form class="follow-form"[\s\S]*?<\/form>/, '')
  expect(head(profileAfter)).toBe(head(profileBefore))
}, 30_000)

test('F32-AC10, F32-AC13: Given Alice blocked Bob and muted Carol, When she opens the settings, Then blocked people come before muted people, each in its own list, with a button to unblock Bob', async () => {
  await aliceBlocksBob()
  await db.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: carolId,
    created_at: 10,
  })

  const html = await page('/settings')

  const blocked =
    /<section class="panel" id="blocks">([\s\S]*?)<\/section>/.exec(
      html,
    )?.[1] ?? ''
  const muted =
    /<section class="panel" id="mutes">([\s\S]*?)<\/section>/.exec(html)?.[1] ??
    ''
  expect(html.indexOf('id="blocks"')).toBeLessThan(html.indexOf('id="mutes"'))
  expect(blocked).toContain('<h2>ブロックしている人</h2>')
  expect(blocked).toContain('action="/blocks/bob/release"')
  expect(blocked).toContain('aria-label="@bob のブロックを解除"')
  expect(blocked).toMatch(/>\s*ブロックを解除\s*<\/button>/)
  expect(blocked).not.toContain('carol')
  expect(muted).toContain('action="/mutes/carol/release"')
  expect(muted).not.toContain('bob')
})

test('F32-AC13: Given Alice blocked nobody, When she opens the settings, Then the blocked list says so', async () => {
  expect(await page('/settings')).toContain('ブロックしている人はいません。')
})
