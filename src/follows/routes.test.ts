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
import { LANG_COOKIE } from '../site/i18n'
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
  headers: Record<string, string> = {},
) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, ...headers },
      body: new URLSearchParams(values),
    }),
    env,
  )

const foreignOrigin = 'https://elsewhere.example'
const jsonResponse = { Accept: 'text/html, application/json' }
const postForState = (
  path: string,
  values: Record<string, string>,
  cookie = alice,
  origin = TEST_ORIGIN,
) => post(path, values, cookie, origin, jsonResponse)

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

async function expectJson(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Content-Type')).toContain('application/json')
  expect(await response.json()).toEqual(body)
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
    new RegExp(
      `<button\\b[^>]*>\\s*(?:<span class="state">)?${label}(?:</span\\s*><span class="act">[^<]+</span>)?\\s*</button\\s*>`,
    ),
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
  ['ja', 'フォロー', 'フォローする', 'フォロー中', 'フォローを解除する'],
  ['en', 'Follow', 'Follow', 'Following', 'Unfollow'],
])(
  'F21-AC1: Given Alice is reading Bob’s slide in %s, When she confirms a follow and then a release beside Bob’s name, Then both forms return to that page and her link changes',
  async (lang, start, follow, following, unfollow) => {
    const url = `${slide}?lang=${lang}`
    const original = await get(url)
    expect(original.status).toBe(200)
    const html = await original.text()
    const author = /<p class="viewer-author">([\s\S]*?)<\/p>/.exec(html)?.[1]
    expect(author).toContain('@bob')
    expect(original.headers.get('Content-Security-Policy')).toContain(
      "form-action 'none'",
    )
    const link = confirmLink(author ?? '', start)
    expect(link).toBe(confirmPath('bob', slide))
    const confirm = await pageAt(`${link}&lang=${lang}`)
    expect(confirm).toContain(`<title>${start} - Slide</title>`)
    if (lang === 'ja')
      expect(confirm).toContain(
        '@bob さんが新しいスライドを公開すると、お知らせに届きます。相手には、あなたがフォローしたことが伝わります。フォローは、設定で解除できます。',
      )
    const create = submittedForm(confirm, '/follows', follow)
    expect(create.values).toEqual({ handle: 'bob', slide })
    expect(await pairs()).toEqual([])
    expectRedirect(await post(create.action, create.values), slide)
    expect(await pairs()).toEqual([aliceFollowsBob])

    const again = confirmLink(await pageAt(url), following)
    expect(again).toBe(link)
    const confirmation = await pageAt(`${again}&lang=${lang}`)
    expect(confirmation).toContain(
      lang === 'ja'
        ? '<title>フォローの解除 - Slide</title>'
        : '<title>Unfollow - Slide</title>',
    )
    expect(confirmation).toContain(
      lang === 'ja'
        ? '解除すると、@bob さんが新しいスライドを公開しても、お知らせは届かなくなります。'
        : 'If you unfollow @bob, you’ll stop receiving notifications when they publish new slides.',
    )
    expect(confirmation).not.toContain('action="/follows"')
    const release = submittedForm(confirmation, releaseBob, unfollow)
    expect(release.values.slide).toBe(slide)
    expectRedirect(await post(release.action, release.values), slide)
    expect(await pairs()).toEqual([])
    expect(confirmLink(await pageAt(url), start)).toBe(link)
  },
)

const followControl = /(?:href|action)="\/follows["/?]/

test('F21-AC1: Given a reader requests JSON, When she follows twice and releases, Then each response reports her stored state', async () => {
  for (const path of ['/follows', '/follows', releaseBob]) {
    const following = path === '/follows'
    await expectJson(await postForState(path, fields), 200, { following })
    expect(await pairs()).toEqual(following ? [aliceFollowsBob] : [])
  }
})

test.each([
  ['muted', 'bob'],
  ['suspended', 'bob'],
  ['unknown', 'missing'],
  ['self', 'alice'],
])(
  'Given the author is %s, When a reader sends a follow form requesting JSON, Then the state is false and no follow is stored',
  async (reason, handle) => {
    if (reason === 'muted') expectRedirect(await post('/mutes', fields), slide)
    if (reason === 'suspended') await suspend(INVITED_ID)
    await expectJson(await postForState('/follows', { handle, slide }), 200, {
      following: false,
    })
    expect(await pairs()).toEqual([])
  },
)

test.each(['/follows', releaseBob])(
  'Given a signed-out reader, When she posts to %s requesting JSON, Then she gets a sign-in error and nothing is stored',
  async (path) => {
    await expectJson(await postForState(path, fields, ''), 401, {
      error: 'sign_in',
    })
    expect(await pairs()).toEqual([])
  },
)

const storedSettings = () =>
  db.batch([
    db.select().from(follows),
    db.select().from(mutes),
    db.select().from(notifications),
    db.select().from(notificationOptOuts),
  ])

test.each([
  { path: '/follows', values: fields },
  { path: releaseBob, values: fields },
  { path: '/mutes', values: fields },
  { path: '/mutes/bob/release', values: fields },
  {
    path: '/notifications/preferences',
    values: { kind: 'followed', receive: '0' },
  },
])(
  'Given a form route $path, When the POST is not a form or comes from a foreign origin, Then the route refuses it and the stored rows stay unchanged',
  async ({ path, values }) => {
    if (path === releaseBob)
      expectRedirect(await post('/follows', fields), slide)
    if (path === '/mutes/bob/release')
      expectRedirect(await post('/mutes', fields), slide)
    const before = await storedSettings()
    for (const origin of [TEST_ORIGIN, foreignOrigin]) {
      for (const type of ['application/json', 'text/plain']) {
        const response = await server.fetch(
          new Request(new URL(path, TEST_ORIGIN), {
            method: 'POST',
            headers: {
              Cookie: alice,
              Origin: origin,
              'Content-Type': type,
              Accept: origin === TEST_ORIGIN ? 'text/html' : 'application/json',
            },
            body: JSON.stringify(values),
          }),
          env,
        )
        expect(response.status, `${type} from ${origin}`).toBe(415)
        expect(await storedSettings()).toEqual(before)
      }
    }
    const form = new FormData()
    for (const [name, value] of Object.entries(values)) form.set(name, value)
    const sendMultipart = (origin: string) =>
      server.fetch(
        new Request(new URL(path, TEST_ORIGIN), {
          method: 'POST',
          headers: { Cookie: alice, Origin: origin },
          body: form,
        }),
        env,
      )
    expect((await sendMultipart(foreignOrigin)).status).toBe(403)
    expect(await storedSettings()).toEqual(before)
    expect((await sendMultipart(TEST_ORIGIN)).status).toBe(303)
    expect(await storedSettings()).not.toEqual(before)
  },
)

test.each([
  ['ja', 'フォロー', 'フォロー中', 'フォローを解除する'],
  ['en', 'Follow', 'Following', 'Unfollow'],
])(
  'F21-AC7: Given Alice opens Bob’s profile in %s, When she submits the follow and release buttons beside his name, Then each POST returns to his profile with the opposite button',
  async (lang, follow, following, unfollow) => {
    const cookie = `${alice}; ${LANG_COOKIE}=${lang}`
    const heading = async () => {
      const response = await get(profile, cookie)
      expect(response.status).toBe(200)
      const policy = response.headers.get('Content-Security-Policy')
      expect(policy?.match(/\bform-action\b[^;]*/g)).toEqual([
        "form-action 'self' https://github.com",
      ])
      const page = await response.text()
      expect(page).not.toContain('/follows/new')
      const author =
        /<div class="profile-heading">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? ''
      expect(author.match(/<form\b/g)).toHaveLength(1)
      return author
    }
    const create = submittedForm(await heading(), '/follows', follow)
    expect(create.values).toEqual({ handle: 'bob', slide: profile })
    expectRedirect(await post(create.action, create.values, cookie), profile)
    expect(await pairs()).toEqual([aliceFollowsBob])

    const afterFollow = await heading()
    const release = submittedForm(afterFollow, releaseBob, following)
    expect(afterFollow).toContain(`aria-label="${unfollow}"`)
    expect(afterFollow).toContain(`title="${unfollow}"`)
    expect(release.values).toEqual({ slide: profile })
    expectRedirect(await post(release.action, release.values, cookie), profile)
    expect(await pairs()).toEqual([])
    expect(submittedForm(await heading(), '/follows', follow)).toEqual(create)
  },
)

test('F21-AC2: Given Alice opens her own deck and profile, When she tries to follow herself directly, Then no follow control is offered and no follow is stored', async () => {
  for (const path of [aliceSlide, '/@alice'])
    expect(await pageAt(path)).not.toMatch(followControl)
  expect((await get(confirmPath('alice', aliceSlide))).status).toBe(404)
  expectRedirect(
    await post('/follows', { handle: 'alice', slide: aliceSlide }),
    aliceSlide,
  )
  expect(await pairs()).toEqual([])
})

const followingSection = (page: string) =>
  /<section class="panel" id="following">([\s\S]*?)<\/section>/.exec(
    page,
  )?.[1] ?? ''

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
      expect(body).not.toMatch(/>\s*フォロー中\s*<|id="following"/)
      if (!cookie) expect(body).not.toMatch(followControl)
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

test('F21-AC5: Given Alice muted Bob, When she visits his profile and deck, Then both hide the follow control, the confirmation explains the mute, and a direct POST stores nothing', async () => {
  expectRedirect(await post('/mutes', fields), slide)
  expect(await pageAt(profile)).not.toMatch(followControl)
  const viewer = await pageAt(slide)
  expect(viewer).toContain('<a class="author-link" href="/@bob">')
  const follow = /<a\b[^>]*\bdata-follow-handle="bob"[^>]*>/.exec(viewer)?.[0]
  expect(follow).toMatch(/\shidden(?:[\s=>])/)
  expect(follow).toContain('data-following="false"')
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
  expect(
    (await postForState('/follows', fields, alice, foreignOrigin)).status,
  ).toBe(403)
  expect(await pairs()).toEqual([])
  expectRedirect(await post('/follows', fields), slide)
  expect(
    (await postForState(releaseBob, {}, alice, foreignOrigin)).status,
  ).toBe(403)
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
    expect(await pageAt(path)).not.toMatch(followControl)
  for (const response of [
    await get(confirmPath('bob', slide)),
    await post('/follows', fields),
    await post(releaseBob, {}),
    await postForState('/follows', fields),
    await postForState(releaseBob, fields),
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
