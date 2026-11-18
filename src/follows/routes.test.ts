import { drizzle } from 'drizzle-orm/d1'
import { decodeHTML } from 'entities'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  follows,
  mutes,
  notificationOptOuts,
  notifications,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = {
  ...testEnv(platform.env),
  AUTHOR_GITHUB_IDS: [OWNER_ID, INVITED_ID, CAROL_ID].join(','),
} as unknown as Env
const slide = '/@bob/talk/3'
const profile = '/@bob'
const aliceSlide = '/@alice/keynote'
const aliceFollowsBob = { follower: OWNER_ID, followee: INVITED_ID }
const fields = { handle: 'bob', slide }
const releaseBob = '/follows/bob/release'
let alice = ''
let bob = ''
let carol = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  carol = await signIn(env, 'carol', { id: CAROL_ID })
  for (const cookie of [alice, bob, carol]) expect(cookie).not.toBe('')
  await seedPublic(database, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
})
beforeEach(async () => {
  await db.batch([
    db.delete(follows),
    db.delete(mutes),
    db.delete(suspensions),
    db.delete(notifications),
    db.delete(notificationOptOuts),
  ])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )

const post = (
  path: string,
  values: Record<string, string>,
  cookie = alice,
  origin = TEST_ORIGIN,
) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: new URLSearchParams(values),
    }),
    env,
  )

const confirmPath = (handle: string, path: string) =>
  `/follows/new?${new URLSearchParams({ handle, slide: path })}`

const pairs = () =>
  db
    .select({
      follower: follows.follower_user_id,
      followee: follows.followee_user_id,
    })
    .from(follows)

const suspend = (userId: string) =>
  db.insert(suspensions).values({
    user_id: userId,
    reason: 'suspended',
    suspended_at: 300,
    suspended_by: 'operator',
  })

function expectRedirect(response: Response, path: string) {
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe(path)
}

async function pageAt(path: string, cookie = alice) {
  const response = await get(path, cookie)
  expect(response.status).toBe(200)
  return response.text()
}

function confirmLink(html: string, label: string) {
  const link =
    /<a\b[^>]*\bhref="(\/follows\/new\?[^"]+)"[^>]*>\s*([^<]+?)\s*<\/a\s*>/.exec(
      html,
    )
  expect(link?.[2]).toBe(label)
  return decodeHTML(link?.[1] ?? '')
}

function submittedForm(html: string, action: string, label: string) {
  const forms = [
    ...html.matchAll(
      /<form\b[^>]*method="post"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g,
    ),
  ]
  const form = forms.find(([, path]) => path === action)
  expect(form?.[2]).toMatch(
    new RegExp(`<button\\b[^>]*>\\s*${label}\\s*</button\\s*>`),
  )
  const inputs = (form?.[2] ?? '').matchAll(
    /<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g,
  )
  return {
    action: form?.[1] ?? '',
    buttonName: /<button\b[^>]*\baria-label="([^"]+)"/.exec(
      form?.[2] ?? '',
    )?.[1],
    values: Object.fromEntries(
      [...inputs].map(([, name, value]) => [name, decodeHTML(value)]),
    ),
  }
}

test.each([
  [slide, 'ja', 'フォロー', 'フォローする', 'フォロー中', 'フォローを解除する'],
  [profile, 'en', 'Follow', 'Follow', 'Following', 'Unfollow'],
])(
  'F21-AC1: Given Alice is reading %s, When she confirms a follow and then a release beside Bob’s name, Then both forms return to that page and her link changes',
  async (path, lang, start, follow, following, unfollow) => {
    const url = `${path}?lang=${lang}`
    const original = await get(url)
    expect(original.status).toBe(200)
    const html = await original.text()
    const author =
      path === profile
        ? /<section class="profile">([\s\S]*?)<\/section>/.exec(html)?.[1]
        : /<p class="author">([\s\S]*?)<\/p>/.exec(html)?.[1]
    expect(author).toContain('@bob')
    if (path === slide)
      expect(original.headers.get('Content-Security-Policy')).toContain(
        "form-action 'none'",
      )
    const link = confirmLink(author ?? '', start)
    expect(link).toBe(confirmPath('bob', path))
    const confirm = await pageAt(`${link}&lang=${lang}`)
    if (lang === 'ja')
      expect(confirm).toContain(
        '@bob さんが新しいスライドを公開すると、お知らせに届きます。相手には、あなたがフォローしたことが伝わります。フォローは、設定で解除できます。',
      )
    const create = submittedForm(confirm, '/follows', follow)
    expect(create.values).toEqual({ handle: 'bob', slide: path })
    expect(await pairs()).toEqual([])
    expectRedirect(await post(create.action, create.values), path)
    expect(await pairs()).toEqual([aliceFollowsBob])

    const again = confirmLink(await pageAt(url), following)
    expect(again).toBe(link)
    const confirmation = await pageAt(`${again}&lang=${lang}`)
    expect(confirmation).toContain(
      lang === 'ja'
        ? '解除すると、@bob さんが新しいスライドを公開しても、お知らせは届かなくなります。'
        : 'If you unfollow @bob, you’ll stop receiving notifications when they publish new slides.',
    )
    expect(confirmation).not.toContain('action="/follows"')
    const release = submittedForm(confirmation, releaseBob, unfollow)
    expect(release.values.slide).toBe(path)
    expectRedirect(await post(release.action, release.values), path)
    expect(await pairs()).toEqual([])
    expect(confirmLink(await pageAt(url), start)).toBe(link)
  },
)

test('F21-AC2: Given Alice opens her own deck and profile, When she tries to follow herself directly, Then no link is offered and no follow is stored', async () => {
  for (const path of [aliceSlide, '/@alice'])
    expect(await pageAt(path)).not.toMatch(/\/follows\/|フォロー中/)
  expect((await get(confirmPath('alice', aliceSlide))).status).toBe(404)
  expectRedirect(
    await post('/follows', { handle: 'alice', slide: aliceSlide }),
    aliceSlide,
  )
  expect(await pairs()).toEqual([])
})

const followingSection = (page: string) =>
  /<section id="following">([\s\S]*?)<\/section>/.exec(page)?.[1] ?? ''

test.each([
  ['ja', 'フォローしている人', '解除'],
  ['en', 'People you follow', 'Unfollow'],
])(
  'F21-AC3: Given Alice follows Bob and Carol, When she releases each from settings in %s, Then each profile and form disappear and she sees the empty state',
  async (lang, heading, release) => {
    for (const handle of ['bob', 'carol'])
      expectRedirect(await post('/follows', { handle, slide }), slide)
    const url = `/settings?lang=${lang}`
    const page = await pageAt(url)
    expect(page.indexOf('id="following"')).toBeLessThan(
      page.indexOf('id="mutes"'),
    )
    const section = followingSection(page)
    expect(section).toContain(`<h2>${heading}</h2>`)
    for (const handle of ['bob', 'carol']) {
      expect(section).toContain(`href="/@${handle}">@${handle}</a>`)
      const form = submittedForm(section, `/follows/${handle}/release`, release)
      expect(form.buttonName).toBe(
        lang === 'ja' ? `@${handle} のフォローを解除` : `Unfollow @${handle}`,
      )
      expect(form.values).not.toHaveProperty('slide')
      expectRedirect(await post(form.action, form.values), '/settings')
      expect(followingSection(await pageAt(url))).not.toContain(`/@${handle}`)
    }
    const empty = followingSection(await pageAt(url))
    expect(empty).toContain(
      lang === 'ja'
        ? 'フォローしている人はいません。'
        : 'You aren’t following anyone.',
    )
    expect(empty).not.toContain('<form')
    expect(await pairs()).toEqual([])
  },
)

async function publicPages(cookie: string) {
  const paths = [profile, slide, '/@alice', aliceSlide]
  return Promise.all(
    paths.map(async (path) => {
      const response = await get(path, cookie)
      expect(response.status).toBe(200)
      const cache = response.headers.get('Cache-Control')
      if (cookie) {
        if (path === profile || path === '/@alice')
          expect(cache).toMatch(/private|no-store/)
        else expect(cache).toContain('private')
      }
      const body = await response.text()
      expect(body).not.toMatch(/フォロー中|id="following"/)
      if (!cookie) expect(body).not.toContain('/follows/new')
      return body
    }),
  )
}

test('F21-AC4: Given Carol and an anonymous reader can visit both profiles and viewers, When Alice follows Bob, Then all four pages look identical to each observer', async () => {
  const before = await Promise.all([publicPages(carol), publicPages('')])
  expectRedirect(await post('/follows', fields), slide)
  expect(await pairs()).toEqual([aliceFollowsBob])
  expect(await Promise.all([publicPages(carol), publicPages('')])).toEqual(
    before,
  )
})

test('F21-AC4: Given Bob opens his own profile and settings, When Alice follows him, Then neither page shows who follows him or how many', async () => {
  const own = async () =>
    Promise.all(
      ['/@bob', '/settings'].map(async (path) => (await get(path, bob)).text()),
    )
  const before = await own()
  expectRedirect(await post('/follows', fields), slide)
  expect(await own()).toEqual(before)
})

test('Given the session ended on the confirmation page, When the release is submitted, Then sign-in is asked for and the follow stays', async () => {
  expectRedirect(await post('/follows', fields), slide)
  const response = await post(releaseBob, { slide }, '')
  expect(response.status).toBe(401)
  expect(await response.text()).toContain(
    `href="/auth/github?to=${encodeURIComponent(slide)}"`,
  )
  expect(await pairs()).toEqual([aliceFollowsBob])
})

test('F21-AC5: Given Alice muted Bob, When she visits the confirmation or posts directly, Then it asks her to release the mute in settings and stores nothing', async () => {
  expectRedirect(await post('/mutes', fields), slide)
  const viewer = await pageAt(slide)
  expect(viewer).toContain('href="/@bob">@bob</a>')
  expect(viewer).not.toContain('href="/follows/new?')
  const confirm = await pageAt(confirmPath('bob', slide))
  expect(confirm).toContain('設定でミュートを解除してください。')
  expect(confirm).toContain('href="/settings#mutes"')
  expect(confirm).not.toContain('<form')
  expectRedirect(await post('/follows', fields), slide)
  expect(await pairs()).toEqual([])
})

test.each(['unknown', 'bad_handle', '', 'bob'])(
  'Given the handle %j is unavailable or suspended, When signed-out and signed-in readers request the confirmation, Then both get 404 and a direct POST stores nothing',
  async (handle) => {
    await suspend(INVITED_ID)
    for (const cookie of ['', alice])
      expect((await get(confirmPath(handle, slide), cookie)).status).toBe(404)
    expectRedirect(await post('/follows', { handle, slide }), slide)
    expect(await pairs()).toEqual([])
  },
)

test.each([slide, profile])(
  'Given a signed-out reader at %s, When they open or submit the follow form, Then sign-in points back there and no follow is stored',
  async (path) => {
    for (const response of [
      await get(confirmPath('bob', path), ''),
      await post('/follows', { handle: 'bob', slide: path }, ''),
    ]) {
      expect(response.status).toBe(401)
      const body = await response.text()
      expect(body).toContain(
        `href="/auth/github?to=${encodeURIComponent(path)}"`,
      )
      expect(body).not.toContain('action="/follows"')
    }
    expect(await pairs()).toEqual([])
  },
)

test('Given a foreign origin or a different reader, When they attempt to change Alice’s follow, Then only Alice’s same-origin request can change her row', async () => {
  const foreign = 'https://elsewhere.example'
  expect((await post('/follows', fields, alice, foreign)).status).toBe(403)
  expect(await pairs()).toEqual([])
  expectRedirect(await post('/follows', fields), slide)
  expect((await post(releaseBob, {}, alice, foreign)).status).toBe(403)
  expectRedirect(await post(releaseBob, {}, ''), '/settings')
  expectRedirect(
    await post(releaseBob, { follower: OWNER_ID }, carol),
    '/settings',
  )
  expect(await pairs()).toEqual([aliceFollowsBob])
})

test('Given suspended Alice, When she reads Bob’s pages or sends a follow request, Then both controls are hidden and mutations return the suspension page', async () => {
  await suspend(OWNER_ID)
  for (const path of [profile, slide])
    expect(await pageAt(path)).not.toMatch(/\/follows\/|フォロー中/)
  for (const response of [
    await get(confirmPath('bob', slide)),
    await post('/follows', fields),
    await post(releaseBob, {}),
  ]) {
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('<h1>アカウントは停止中です</h1>')
  }
  expect(await pairs()).toEqual([])
})

test('Given Alice follows Bob before his suspension, When she releases the hidden followee, Then her row is removed and she returns to settings', async () => {
  expectRedirect(await post('/follows', fields), slide)
  await suspend(INVITED_ID)
  expect(followingSection(await pageAt('/settings'))).not.toContain('/@bob')
  expectRedirect(await post(releaseBob, {}), '/settings')
  expect(await pairs()).toEqual([])
})

test('Given an external return URL, When Alice submits a follow or release, Then both mutations redirect to the local slide list', async () => {
  const path = '//elsewhere.example'
  expectRedirect(
    await post('/follows', { handle: 'bob', slide: path }),
    '/slides',
  )
  expect(await pairs()).toEqual([aliceFollowsBob])
  expectRedirect(await post(releaseBob, { slide: path }), '/slides')
  expect(await pairs()).toEqual([])
})

test('F20-AC6: Given Alice confirms a follow, When Bob opens his notifications, Then the notification names Alice and links to her profile', async () => {
  expectRedirect(await post('/follows', fields), slide)
  const list = await pageAt('/notifications', bob)
  const link = /<a\b[^>]*\bhref="\/@alice"[^>]*>([\s\S]*?)<\/a\s*>/.exec(list)
  expect(link?.[1]).toMatch(/>\s*@alice さんに、フォローされました\s*</)
})

test.each(['followed', 'followee_published'])(
  'F20-AC7: Given Alice receives %s, When she disables and re-enables it through preferences, Then the change is stored only for that kind and reader',
  async (kind) => {
    const path = '/notifications/preferences'
    expectRedirect(
      await post(path, { kind, receive: '0' }),
      '/settings#notifications',
    )
    expect(await db.select().from(notificationOptOuts)).toEqual([
      { user_id: OWNER_ID, kind },
    ])
    expectRedirect(
      await post(path, { kind, receive: '1' }),
      '/settings#notifications',
    )
    expect(await db.select().from(notificationOptOuts)).toEqual([])
  },
)
