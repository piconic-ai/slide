import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { authUser } from '../db/auth-schema'
import { profilePictures, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { squarePng } from './test-picture'
import { GRAVATAR_KEEP_SECONDS, gravatarHash } from './gravatar'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env) as unknown as Env
const EMAIL = 'owner@mail.example'
let cookie = ''
let hash = ''

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** Stands in for Gravatar, the one outside service these tests do not reach. */
const gravatar = vi.fn<(url: string) => Promise<Response>>()
const hasPicture = () =>
  gravatar.mockImplementation(
    async () =>
      new Response(PICTURE, { headers: { 'Content-Type': 'image/png' } }),
  )
const hasNone = () =>
  gravatar.mockImplementation(async () => new Response('', { status: 404 }))

beforeAll(async () => {
  await applyMigrations(database)
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  expect(cookie).not.toBe('')
  hash = await gravatarHash(EMAIL)
})
beforeEach(async () => {
  vi.stubGlobal('fetch', (url: string) => gravatar(String(url)))
  gravatar.mockReset()
  await db.delete(profilePictures)
  await db
    .update(profiles)
    .set({ use_gravatar: 1, name: 'Owner', gravatar_at: null })
  for (const prefix of ['avatars/', 'gravatar/']) {
    const listed = await platform.env.UPLOADS.list({ prefix })
    await platform.env.UPLOADS.delete(listed.objects.map(({ key }) => key))
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const get = (path: string, who: string | null = null) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: who ? { Cookie: who } : {},
    }),
    env,
  )
const post = (path: string, fields: [string, string][]) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: new URLSearchParams(fields),
    }),
    env,
  )
const face = () => get(`/avatars/${OWNER_ID}`)
const mainOf = (page: string) =>
  page.slice(page.indexOf('<main'), page.indexOf('</main>'))

test('F28-AC46: Given no uploaded picture and a Gravatar picture, When the face is asked for, Then the Gravatar picture is served', async () => {
  hasPicture()
  const response = await face()
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(PICTURE)
})

test('F28-AC46: Given an uploaded picture that is then removed, When the face is asked for, Then the Gravatar picture comes back where there is one, and the initial where there is not', async () => {
  const form = new FormData()
  form.set('picture', new File([squarePng() as BlobPart], 'face.png'))
  const up = await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: form,
    }),
    env,
  )
  expect(up.status).toBe(303)
  hasPicture()
  const uploaded = await face()
  expect(uploaded.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(squarePng())
  // The uploaded picture wins, and Gravatar is not even asked.
  expect(gravatar).not.toHaveBeenCalled()
  await post('/settings/picture/remove', [])
  const back = await face()
  expect(back.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await back.arrayBuffer())).toEqual(PICTURE)
  expect(gravatar).toHaveBeenCalledTimes(1)
  // Without a Gravatar picture, the face is none and the page draws the initial.
  for (const prefix of ['gravatar/']) {
    const listed = await platform.env.UPLOADS.list({ prefix })
    await platform.env.UPLOADS.delete(listed.objects.map(({ key }) => key))
  }
  hasNone()
  expect((await face()).status).toBe(404)
})

test('F28-AC47: Given a new profile, When settings are opened, Then "use Gravatar" is on', async () => {
  const page = await (await get('/settings', cookie)).text()
  expect(page).toMatch(
    /<input\s+type="checkbox"\s+name="gravatar"\s+value="1"\s+checked/,
  )
  expect(page).toContain('Gravatar の画像を使う')
  const english = await (await get('/settings?lang=en', cookie)).text()
  expect(english).toContain('Use my Gravatar picture')
})

test('F28-AC47: Given "use Gravatar" is turned off, When the face is asked for with no uploaded picture, Then it is none, Gravatar is never asked, and the setting is kept', async () => {
  hasPicture()
  const saved = await post('/settings/profile', [
    ['name', 'Owner'],
    ['gravatar', '0'],
  ])
  expect(saved.status).toBe(303)
  expect((await face()).status).toBe(404)
  expect(gravatar).not.toHaveBeenCalled()
  const page = await (await get('/settings', cookie)).text()
  expect(page).not.toMatch(/name="gravatar"\s+value="1"\s+checked/)
  // Turned on again: the picture is back.
  await post('/settings/profile', [
    ['name', 'Owner'],
    ['gravatar', '0'],
    ['gravatar', '1'],
  ])
  expect((await face()).status).toBe(200)
})

test('F28-AC47: Given a form that does not carry the choice, When the profile is saved, Then the earlier choice stays', async () => {
  await post('/settings/profile', [
    ['name', 'Owner'],
    ['gravatar', '0'],
  ])
  await post('/settings/profile', [['name', 'Renamed']])
  expect((await db.select().from(profiles).get())?.use_gravatar).toBe(0)
})

test('F28-AC48: Given a Gravatar picture that was fetched, When every page that shows a face is opened, Then none carries the address, its hash or a Gravatar URL', async () => {
  hasPicture()
  expect((await face()).status).toBe(200)
  await seedPublic(database, 'talk', 1, 'A talk')
  const pages = [
    ['/@owner', null],
    ['/@owner', cookie],
    ['/@owner/following', cookie],
    ['/@owner/followers', null],
    ['/@owner/talk', null],
    ['/', cookie],
    ['/slides', cookie],
    ['/embed/@owner/talk', null],
  ] as const
  for (const [path, who] of pages) {
    const body = await (await get(path, who)).text()
    expect(body, path).not.toContain(hash)
    expect(body, path).not.toMatch(/gravatar\.com/i)
    expect(body, path).not.toContain(EMAIL)
  }
  const session = await (await get('/api/session', cookie)).text()
  expect(session).not.toContain(hash)
  expect(session).not.toMatch(/gravatar\.com/i)
  expect(session).not.toContain(EMAIL)
  // The settings page shows the address to its owner, and still not the hash or the URL.
  const settings = await (await get('/settings', cookie)).text()
  expect(settings).not.toContain(hash)
  expect(settings).not.toMatch(/gravatar\.com/i)
})

test('F28-AC48: Given the service asks Gravatar, When the request is read, Then only the hash is in it, and no page policy was widened', async () => {
  hasNone()
  await face()
  const [url] = gravatar.mock.calls[0]!
  expect(url).toBe(`https://gravatar.com/avatar/${hash}?s=256&d=404`)
  expect(url).not.toContain('mail.example')
  for (const path of ['/@owner', '/settings', '/@owner/following']) {
    const csp = (await get(path, cookie)).headers.get('content-security-policy')
    expect(csp, path).not.toMatch(/gravatar/i)
    expect(csp, path).toMatch(/img-src 'self'/)
  }
})

test('F28-AC50: Given Gravatar has no picture, When the face is asked for, Then it is 404, and the profile still shows the initial', async () => {
  hasNone()
  const response = await face()
  expect(response.status).toBe(404)
  expect(await response.text()).toBe('')
  const profile = mainOf(await (await get('/@owner')).text())
  expect(profile).toContain('portrait-initial')
  expect(profile).toContain('>O<')
})

test.each([
  [
    'answers with a server error',
    async () => new Response('x', { status: 503 }),
  ],
  ['is rate limiting', async () => new Response('x', { status: 429 })],
  [
    'cannot be reached',
    async () => {
      throw new TypeError('fetch failed')
    },
  ],
  [
    'does not answer in time',
    async () => {
      throw new DOMException('timed out', 'TimeoutError')
    },
  ],
  [
    'answers with HTML',
    async () =>
      new Response('<script>alert(1)</script>', {
        headers: { 'Content-Type': 'text/html' },
      }),
  ],
])(
  'F28-AC50: Given Gravatar %s, When the face is asked for, Then the answer is a plain 404 and not an error, and nothing is kept',
  async (_, behave) => {
    gravatar.mockImplementation(behave)
    const response = await face()
    expect(response.status).toBe(404)
    expect(await platform.env.UPLOADS.get(`gravatar/${OWNER_ID}`)).toBeNull()
  },
)

test('F28-AC50: Given a Gravatar picture kept for longer than a day and Gravatar not answering, When the face is asked for, Then the kept picture is still used', async () => {
  hasPicture()
  await face()
  const kept = await platform.env.UPLOADS.get(`gravatar/${OWNER_ID}`)
  await platform.env.UPLOADS.put(
    `gravatar/${OWNER_ID}`,
    new Uint8Array(await kept!.arrayBuffer()),
    {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: {
        kind: 'image',
        at: String(
          Math.floor(Date.now() / 1000) - GRAVATAR_KEEP_SECONDS.image - 5,
        ),
      },
    },
  )
  gravatar.mockImplementation(async () => {
    throw new TypeError('fetch failed')
  })
  const response = await face()
  expect(response.status).toBe(200)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(PICTURE)
})

test('D-33: Given a Gravatar answer, When the face is asked for twice, Then Gravatar is asked once, and a "none" is asked again after an hour', async () => {
  hasPicture()
  await face()
  await face()
  expect(gravatar).toHaveBeenCalledTimes(1)
  await platform.env.UPLOADS.delete(`gravatar/${OWNER_ID}`)
  gravatar.mockClear()
  hasNone()
  await face()
  await face()
  expect(gravatar).toHaveBeenCalledTimes(1)
  await platform.env.UPLOADS.put(`gravatar/${OWNER_ID}`, '', {
    customMetadata: {
      kind: 'none',
      at: String(
        Math.floor(Date.now() / 1000) - GRAVATAR_KEEP_SECONDS.none - 5,
      ),
    },
  })
  gravatar.mockClear()
  hasPicture()
  expect((await face()).status).toBe(200)
  expect(gravatar).toHaveBeenCalledTimes(1)
})

/** The address of the owner's face that the header is given. */
const sessionFace = async () =>
  (
    (await (await get('/api/session', cookie)).json()) as {
      avatarUrl: string
    }
  ).avatarUrl

test('F28-AC101: Given a Gravatar picture, When it is first asked for, asked for again after its day, and Gravatar is turned off and on, Then the address the pages show changes each time, and only an answer under the address of its own version is kept long', async () => {
  hasPicture()
  // Never asked yet: the address has no time, and its answer is not kept.
  const first = await sessionFace()
  expect(first).toBe(`/avatars/${OWNER_ID}?v=g`)
  const fetched = await get(first)
  expect(fetched.status).toBe(200)
  expect(fetched.headers.get('cache-control')).toBe('no-cache')
  // Asked once, the address names that time and its answer is kept.
  const asked = await sessionFace()
  expect(asked).toMatch(new RegExp(`^/avatars/${OWNER_ID}\\?v=g\\d+$`))
  const kept = await get(asked)
  expect(kept.headers.get('cache-control')).toBe(
    'public, max-age=31536000, immutable',
  )
  expect(gravatar).toHaveBeenCalledTimes(1)
  // A day passes: the answer and its noted time are set back by a day.
  const dayAgo = Math.floor(Date.now() / 1000) - GRAVATAR_KEEP_SECONDS.image - 5
  await platform.env.UPLOADS.put(`gravatar/${OWNER_ID}`, PICTURE, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { kind: 'image', at: String(dayAgo) },
  })
  await db.update(profiles).set({ gravatar_at: dayAgo })
  const old = await sessionFace()
  expect(old).toBe(`/avatars/${OWNER_ID}?v=g${dayAgo}`)
  // The picture is fetched again and the pages show a new address.
  const again = await get(old)
  expect(again.status).toBe(200)
  expect(again.headers.get('cache-control')).toBe('no-cache')
  expect(gravatar).toHaveBeenCalledTimes(2)
  const later = await sessionFace()
  expect(later).not.toBe(old)
  expect((await get(later)).headers.get('cache-control')).toBe(
    'public, max-age=31536000, immutable',
  )
  // Turned off, the face is none; turned on, Gravatar is asked afresh.
  await post('/settings/profile', [
    ['name', 'Owner'],
    ['gravatar', '0'],
  ])
  expect(await sessionFace()).toBe(`/avatars/${OWNER_ID}?v=n`)
  await post('/settings/profile', [
    ['name', 'Owner'],
    ['gravatar', '1'],
  ])
  const back = await sessionFace()
  expect(back).toBe(`/avatars/${OWNER_ID}?v=g`)
  expect((await get(back)).headers.get('cache-control')).toBe('no-cache')
  expect(gravatar).toHaveBeenCalledTimes(3)
})

test('F28-AC101: Given a Gravatar picture kept before its time was noted in D1, When it is asked for, Then the time is noted, and the pages show the address of that picture', async () => {
  const at = Math.floor(Date.now() / 1000) - 60
  await platform.env.UPLOADS.put(`gravatar/${OWNER_ID}`, PICTURE, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { kind: 'image', at: String(at) },
  })
  expect(await sessionFace()).toBe(`/avatars/${OWNER_ID}?v=g`)
  expect((await get(`/avatars/${OWNER_ID}?v=g`)).status).toBe(200)
  expect(gravatar).not.toHaveBeenCalled()
  expect(await sessionFace()).toBe(`/avatars/${OWNER_ID}?v=g${at}`)
})

test('F28-AC49: Given Gravatar picture of one person, When another person’s face is asked for by their id, Then it is theirs and the hash comes from their own address', async () => {
  hasNone()
  await signIn(env, 'second', { id: '777', name: 'Second' })
  await get('/avatars/777')
  const [url] = gravatar.mock.calls.at(-1)!
  expect(url).toContain(await gravatarHash('second@mail.example'))
  expect(url).not.toContain(hash)
})

test('F28-AC70: Given someone who signed in but has not made an account, When their face is asked for, Then Gravatar is not asked and the answer is 404', async () => {
  const email = 'before-consent@mail.example'
  await db.insert(authUser).values({
    id: 'before-consent',
    name: '',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  hasPicture()
  const response = await get('/avatars/before-consent')
  expect(response.status).toBe(404)
  expect(gravatar).not.toHaveBeenCalled()
  // Nor is the hash of their address kept anywhere Gravatar could be asked.
  expect(
    await platform.env.UPLOADS.list({ prefix: 'gravatar/before-consent' }),
  ).toMatchObject({ objects: [] })
})
