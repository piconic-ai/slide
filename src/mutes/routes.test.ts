import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, mutes, suspensions } from '../db/schema'
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
const slide = '/@bob/talk'
const aliceSlide = '/@alice/keynote'
const carolId = '999'
let alice = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  expect(alice).not.toBe('')
  expect(bob).not.toBe('')
  await db.insert(accounts).values({
    user_id: carolId,
    handle: 'carol',
    created_at: 1,
  })
  await seedPublic(database, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
})
beforeEach(async () => {
  await db.batch([db.delete(mutes), db.delete(suspensions)])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )

const post = (
  path: string,
  fields: Record<string, string>,
  cookie = alice,
  origin: string | null = TEST_ORIGIN,
) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: {
        Cookie: cookie,
        ...(origin === null ? {} : { Origin: origin }),
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )

const newMute = (handle: string, path: string) =>
  `/mutes/new?${new URLSearchParams({ handle, slide: path })}`

const pairs = () =>
  db
    .select({ muter: mutes.muter_user_id, muted: mutes.muted_user_id })
    .from(mutes)

const aliceMutedBob = { muter: OWNER_ID, muted: INVITED_ID }

function menuOf(html: string) {
  const menu = /<details class="deck-menu">([\s\S]*?)<\/details>/.exec(
    html,
  )?.[1]
  expect(menu).toBeDefined()
  return menu ?? ''
}

function expectRedirect(response: Response, path: string) {
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe(path)
}

async function expectRecent(paths: string[]) {
  const recent = await get('/api/public/slides')
  expect(recent.status).toBe(200)
  expect(await recent.json()).toEqual(
    paths.map((href) => expect.objectContaining({ href })),
  )
}

test.each([
  [slide, 'ja', 'この作者をミュート', 'ミュート中', '設定で解除'],
  [`${slide}/3`, 'en', 'Mute this author', 'Muted', 'Release in settings'],
])(
  'F19-AC1: Given Alice is reading %s, When she mutes Bob from the menu, Then she returns to that slide with a muted status and his deck leaves her recent list',
  async (path, lang, action, status, release) => {
    const url = `${path}?lang=${lang}`
    const viewer = await get(url)
    expect(viewer.status).toBe(200)
    expect(
      viewer.headers.get('Content-Security-Policy')?.split('; '),
    ).toContain("form-action 'none'")
    const menu = menuOf(await viewer.text())
    expect(menu).toContain(action)
    const link = /href="(\/mutes\/new\?[^"]+)"/.exec(menu)?.[1]
    expect(link?.replaceAll('&amp;', '&')).toBe(newMute('bob', path))
    expect(menu.indexOf('/reports/new')).toBeGreaterThanOrEqual(0)
    expect(menu.indexOf('/mutes/new')).toBeGreaterThan(
      menu.indexOf('/reports/new'),
    )

    await expectRecent([slide, aliceSlide])
    expectRedirect(await post('/mutes', { handle: 'bob', slide: path }), path)
    expect(await pairs()).toEqual([aliceMutedBob])
    const updated = menuOf(await (await get(url)).text())
    expect(updated).toContain(status)
    expect(updated).toContain('href="/settings"')
    expect(updated).toContain(release)
    expect(updated).not.toContain('/mutes/new')
    expect(updated).not.toContain('/release')
    await expectRecent([aliceSlide])
  },
)

test.each([
  [
    'ja',
    '@bob をミュートしますか？',
    '一覧',
    'URL',
    '設定で解除',
    'この作者をミュート',
    'スライドに戻る',
  ],
  [
    'en',
    'Mute @bob?',
    'lists',
    'URL',
    'in settings',
    'Mute this author',
    'Back to the slides',
  ],
])(
  'F19-AC1: Given Alice uses %s, When she opens the mute page, Then it names Bob, explains muting, carries the handle and slide in its form, and links back',
  async (lang, heading, lists, direct, settings, action, back) => {
    const path = `${slide}/3`
    const response = await get(`${newMute('bob', path)}&lang=${lang}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "form-action 'self'",
    )
    const page = await response.text()
    expect(page).toContain(`<h1>${heading}</h1>`)
    const explanation = /<h1>[^<]+<\/h1>\s*<p>([^<]+)<\/p>/.exec(page)?.[1]
    for (const part of [lists, direct, settings])
      expect(explanation).toContain(part)
    const form = /<form method="post" action="\/mutes">([\s\S]*?)<\/form>/.exec(
      page,
    )?.[1]
    expect(form).toContain('type="hidden" name="handle" value="bob"')
    expect(form).toContain(`type="hidden" name="slide" value="${path}"`)
    expect(form).toContain(`<button type="submit">${action}</button>`)
    expect(page).toContain(`href="${path}">${back}</a>`)
    expect(await pairs()).toEqual([])
  },
)

test('F19-AC7: Given Alice is on her own deck, When she opens the menu or submits her handle, Then there is no mute item and nothing is stored', async () => {
  const menu = menuOf(await (await get(aliceSlide)).text())
  expect(menu).not.toMatch(/ミュート|\/mutes|\/settings/)
  expect((await get(newMute('alice', aliceSlide))).status).toBe(404)
  expectRedirect(
    await post('/mutes', { handle: 'alice', slide: aliceSlide }),
    aliceSlide,
  )
  expect(await pairs()).toEqual([])
})

test('F19-AC7: Given an anonymous reader, When they visit the viewer and mute page or submit the form, Then the menu has no mute item, sign-in returns to the slide and nothing is stored', async () => {
  const path = `${slide}/3`
  expect(menuOf(await (await get(path, '')).text())).not.toMatch(
    /ミュート|\/mutes|\/settings/,
  )
  const response = await get(newMute('bob', path), '')
  expect(response.status).toBe(401)
  const page = await response.text()
  expect(page).toContain(`href="/auth/github?to=${encodeURIComponent(path)}"`)
  expect(page).not.toContain('action="/mutes"')
  expect(
    (await post('/mutes', { handle: 'bob', slide: path }, '')).status,
  ).toBe(401)
  expect(await pairs()).toEqual([])
})

test.each(['unknown', 'bad_handle', ''])(
  'F19-AC1: Given the invalid or unknown handle %j, When Alice opens or posts the mute form, Then the page is not found and the POST stores nothing',
  async (handle) => {
    expect((await get(newMute(handle, slide))).status).toBe(404)
    expectRedirect(await post('/mutes', { handle, slide }), slide)
    expect(await pairs()).toEqual([])
  },
)

test('F19-AC1: Given missing form fields, When Alice posts without a handle, Then nothing is stored and the redirect uses the slide if supplied', async () => {
  expectRedirect(await post('/mutes', {}), '/slides')
  expectRedirect(await post('/mutes', { slide }), slide)
  expect(await pairs()).toEqual([])
})

test.each([
  undefined,
  'https://elsewhere.example/@bob/talk',
  '//elsewhere.example/@bob/talk',
  '/@bob',
  'settings',
])(
  'F19-AC1: Given a valid author and unusable return path %j, When Alice mutes the author, Then the mute is stored and the redirect stays at /slides',
  async (destination) => {
    const fields: Record<string, string> = { handle: 'bob' }
    if (destination !== undefined) fields.slide = destination
    expectRedirect(await post('/mutes', fields), '/slides')
    expect(await pairs()).toEqual([aliceMutedBob])
  },
)

test.each([null, 'https://elsewhere.example'])(
  'F19-AC1: Given Origin %j, When Alice posts a mute, Then CSRF refuses the request and nothing is stored',
  async (origin) => {
    const response = await post(
      '/mutes',
      { handle: 'bob', slide },
      alice,
      origin,
    )
    expect(response.status).toBe(403)
    expect(await pairs()).toEqual([])
  },
)

test('F19-AC1: Given a suspended viewer, When she posts a mute, Then she receives the suspension page and nothing is stored', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'suspended',
    suspended_at: 300,
    suspended_by: 'operator',
  })
  const response = await post('/mutes', { handle: 'bob', slide })
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('<h1>アカウントは停止中です</h1>')
  expect(await pairs()).toEqual([])
})

test.each([
  ['ja', 'ミュートしている人', 'ミュートしている人はいません。', '解除'],
  ['en', 'People you muted', 'You haven’t muted anyone.', 'Release'],
])(
  'F19-AC5: Given Alice uses %s and has muted Bob and Carol, When she opens settings and releases them, Then their profile links and buttons disappear and Bob’s deck returns',
  async (lang, title, empty, release) => {
    const url = `/settings?lang=${lang}`
    for (const handle of ['bob', 'carol'])
      expectRedirect(await post('/mutes', { handle, slide }), slide)
    const page = await (await get(url)).text()
    expect(page).toContain(`<h2>${title}</h2>`)
    for (const handle of ['bob', 'carol']) {
      expect(page).toContain(`href="/@${handle}">@${handle}</a>`)
      expect(page).toContain(`method="post" action="/mutes/${handle}/release"`)
    }
    expect(page).toContain(`<button type="submit">${release}</button>`)
    await expectRecent([aliceSlide])
    expectRedirect(await post('/mutes/bob/release', {}), '/settings')
    expect(await pairs()).toEqual([{ muter: OWNER_ID, muted: carolId }])
    await expectRecent([slide, aliceSlide])
    expectRedirect(await post('/mutes/carol/release', {}), '/settings')
    const cleared = await (await get(url)).text()
    expect(cleared).toContain(`<p>${empty}</p>`)
    expect(cleared).not.toContain('/release"')
    expect(await pairs()).toEqual([])
  },
)

test.each([false, true])(
  'F19-AC5: Given Alice muted Carol and Bob’s mute is %s, When Bob releases Carol naming Alice as the muter, Then only Alice’s row remains',
  async (bobMutedCarol) => {
    expectRedirect(await post('/mutes', { handle: 'carol', slide }), slide)
    if (bobMutedCarol)
      expectRedirect(
        await post('/mutes', { handle: 'carol', slide }, bob),
        slide,
      )
    expectRedirect(
      await post('/mutes/carol/release', { muter: OWNER_ID }, bob),
      '/settings',
    )
    expect(await pairs()).toEqual([{ muter: OWNER_ID, muted: carolId }])
  },
)

test('F19-AC5: Given an existing mute, When a release lacks a matching origin or signed-in owner, Then it is refused and the row stays', async () => {
  expectRedirect(await post('/mutes', { handle: 'bob', slide }), slide)
  expect((await post('/mutes/bob/release', {}, alice, null)).status).toBe(403)
  expect((await post('/mutes/bob/release', {}, '')).status).toBe(401)
  expect(await pairs()).toEqual([aliceMutedBob])
})

async function bobsResponses() {
  const paths = [slide, aliceSlide, '/@bob', '/settings', '/slides']
  return Promise.all(
    paths.map(async (path) => {
      const response = await get(path, bob)
      expect(response.status).toBe(200)
      return {
        path,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      }
    }),
  )
}

test('F19-AC6: Given Bob can see both viewers, his profile, settings and slides, When Alice mutes him, Then all five of Bob’s responses remain identical', async () => {
  const before = await bobsResponses()
  expectRedirect(await post('/mutes', { handle: 'bob', slide }), slide)
  expect(await pairs()).toEqual([aliceMutedBob])
  expect(await bobsResponses()).toEqual(before)
})

test.each([
  ['F19-AC1', 'GET', '/mutes/new'],
  ['F19-AC1', 'POST', '/mutes'],
  ['F19-AC5', 'POST', '/mutes/x/release'],
])(
  '%s: Given a client over its management budget, When it sends %s to %s, Then the request is refused before the mute handler runs',
  async (_, method, path) => {
    const limited = {
      ...env,
      MANAGEMENT_RATE_LIMITER: { limit: async () => ({ success: false }) },
    } as unknown as Env
    const response = await server.fetch(
      new Request(new URL(path, TEST_ORIGIN), {
        method,
        headers: {
          Cookie: alice,
          // A GET is first offered to the static assets, and the local
          // runtime refuses an asset request that carries another origin.
          ...(method === 'POST' ? { Origin: TEST_ORIGIN } : {}),
          'CF-Connecting-IP': '192.0.2.50',
        },
        body:
          method === 'POST'
            ? new URLSearchParams({ handle: 'bob', slide })
            : undefined,
      }),
      limited,
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await pairs()).toEqual([])
  },
)
