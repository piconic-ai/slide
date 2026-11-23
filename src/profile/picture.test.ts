import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { profilePictures } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  seedPerson,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { PICTURE_MAX_BYTES } from './picture-policy'
import { fakeJpeg, png } from './test-picture'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env) as unknown as Env
let cookie = ''

beforeAll(async () => {
  await applyMigrations(database)
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  expect(cookie).not.toBe('')
})
beforeEach(async () => {
  await db.delete(profilePictures)
  const listed = await platform.env.UPLOADS.list({ prefix: 'avatars/' })
  await platform.env.UPLOADS.delete(listed.objects.map(({ key }) => key))
})
afterAll(() => platform.dispose())

const streamOf = (data: Uint8Array) => new Blob([data as BlobPart]).stream()
/** What the image service says a stored picture is. */
const infoOf = (data: Uint8Array) => platform.env.IMAGES.info(streamOf(data))
/** The same picture in another format, made by the same image service. */
const convert = async (
  data: Uint8Array,
  format: 'image/jpeg' | 'image/webp',
) => {
  const out = await platform.env.IMAGES.input(streamOf(data)).output({ format })
  return new Uint8Array(await out.response().arrayBuffer())
}

const upload = (
  data: Uint8Array | string,
  { name = 'face.png', headers = {} as Record<string, string> } = {},
  who = cookie,
) => {
  const form = new FormData()
  form.set('picture', new File([data as BlobPart], name))
  return server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: who, Origin: TEST_ORIGIN, ...headers },
      body: form,
    }),
    env,
  )
}
const get = (path: string, who: string | null = cookie) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: who ? { Cookie: who } : {},
    }),
    env,
  )
const stored = async () =>
  (await platform.env.UPLOADS.list({ prefix: 'avatars/' })).objects.map(
    ({ key }) => key,
  )

test.each([
  ['PNG', async () => png(300, 200)],
  ['JPEG', async () => convert(png(300, 200), 'image/jpeg')],
  ['WebP', async () => convert(png(300, 200), 'image/webp')],
] as const)(
  'F28-AC41: Given a %s, When it is uploaded, Then the header, the profile and the viewer’s author all draw the picture served at the owner’s id',
  async (_, make) => {
    const response = await upload(await make())
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/settings?saved=picture#profile',
    )
    const path = `/avatars/${OWNER_ID}`
    // The header reads the session, which names the picture.
    const session = (await (await get('/api/session')).json()) as {
      avatarUrl: string
    }
    expect(session.avatarUrl).toBe(path)
    const profile = await (await get('/@owner')).text()
    expect(profile).toContain(`src="${path}"`)
    const picture = await get(path)
    expect(picture.status).toBe(200)
    expect(picture.headers.get('content-type')).toBe('image/webp')
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(0)
  },
)

test('F28-AC41: Given an uploaded picture, When a slide of the author is opened, Then the viewer’s author row draws it', async () => {
  // The viewer reads the author's profile the same way the profile page does.
  await upload(png(10, 10))
  await seedPublic(database, 'talk', 1, 'A talk')
  const viewer = await (await get('/@owner/talk', null)).text()
  expect(viewer).toContain(`src="/avatars/${OWNER_ID}"`)
})

test('F28-AC41: Given a settings page, When the picture is uploaded, Then the preview there is the new address, one that changes with each upload', async () => {
  await upload(png(10, 10))
  const page = await (await get('/settings?saved=picture')).text()
  expect(page).toMatch(new RegExp(`src="/avatars/${OWNER_ID}\\?v=\\d+"`))
  expect(page).toContain('プロフィール画像を変えました。')
})

test.each([
  ['GIF', 'GIF89a' + 'x'.repeat(40), 'face.gif'],
  [
    'SVG',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'face.svg',
  ],
  ['HTML named .png', '<!doctype html><title>x</title>', 'face.png'],
  ['text', 'just some words', 'face.txt'],
] as const)(
  'F28-AC42: Given a %s, When it is uploaded, Then it is refused with the reason and nothing is stored',
  async (_, data, name) => {
    const response = await upload(data, { name })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(
      'PNG、JPEG、WebP の画像だけ使えます。',
    )
    expect(await stored()).toEqual([])
    expect(await db.select().from(profilePictures)).toEqual([])
  },
)

test('F28-AC43: Given a file over 1 MB, When it is uploaded, Then it is refused with the reason and nothing is stored', async () => {
  const big = new Uint8Array(PICTURE_MAX_BYTES + 1)
  big.set(png(2, 2))
  const response = await upload(big)
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('画像は 1 MB までです。')
  expect(await stored()).toEqual([])
})

test('F28-AC43: Given a body that declares itself far over 1 MB, When it is posted, Then it is refused without being read', async () => {
  const response = await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': String(50 * 1024 * 1024),
      },
      body: '--x--',
    }),
    env,
  )
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('画像は 1 MB までです。')
})

test('F28-AC44: Given PNG bytes that are cut short or broken, When they are uploaded, Then they are refused as unreadable and nothing is stored', async () => {
  const whole = png(300, 200)
  for (const data of [
    whole.subarray(0, 60),
    whole.subarray(0, 8),
    whole.subarray(0, 40),
  ]) {
    const response = await upload(data)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('画像として読めませんでした。')
  }
  const junk = new Uint8Array(500)
  junk.set(png(2, 2).subarray(0, 33))
  expect((await upload(junk)).status).toBe(400)
  expect(await stored()).toEqual([])
})

test('F28-AC44: Given no file in the form, When it is posted, Then it is refused asking for an image', async () => {
  const response = await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: new FormData(),
    }),
    env,
  )
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('画像を選んでください。')
})

test('F28-AC45: Given a wide picture, When it is uploaded, Then a 256 by 256 square is stored, as the only object, and the original is not kept', async () => {
  const original = png(600, 200)
  await upload(original)
  expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
  const object = await platform.env.UPLOADS.get(`avatars/${OWNER_ID}`)
  const bytes = new Uint8Array(await object!.arrayBuffer())
  expect(await infoOf(bytes)).toMatchObject({
    format: 'image/webp',
    width: 256,
    height: 256,
  })
  expect(Buffer.from(bytes).equals(Buffer.from(original))).toBe(false)
  // Nothing under any other name holds the upload.
  const everything = await platform.env.UPLOADS.list()
  expect(
    everything.objects.filter((o) => o.key.startsWith('avatars/')),
  ).toHaveLength(1)
})

test('F28-AC45: Given a tiny picture, When it is uploaded, Then it is also a 256 by 256 square', async () => {
  await upload(png(3, 5))
  const object = await platform.env.UPLOADS.get(`avatars/${OWNER_ID}`)
  const info = await infoOf(new Uint8Array(await object!.arrayBuffer()))
  expect(info).toMatchObject({ width: 256, height: 256 })
})

test('F28-AC41: Given a second upload, When it is stored, Then it replaces the first and one picture remains', async () => {
  await upload(png(20, 20))
  const first = await db.select().from(profilePictures).get()
  await upload(png(40, 10))
  expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
  expect(await db.select().from(profilePictures)).toHaveLength(1)
  expect(first?.user_id).toBe(OWNER_ID)
})

test('F28-AC49: Given another person and a reader who is not signed in, When the owner’s picture is asked for by id, Then it is served, and the answer carries nothing but the image', async () => {
  await upload(png(20, 20))
  await seedPerson(database, '555', 'other')
  for (const who of [null, cookie]) {
    const response = await get(`/avatars/${OWNER_ID}`, who)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    const dump = JSON.stringify([...response.headers])
    expect(dump).not.toContain('mail.example')
    expect(dump).not.toMatch(/gravatar/i)
  }
})

test.each([
  ['an id nobody has', '/avatars/nobody'],
  ['an email address', '/avatars/owner@mail.example'],
  ['a path', '/avatars/..%2Fsecret'],
  ['an over-long id', `/avatars/${'a'.repeat(65)}`],
])(
  'F28-AC49: Given %s, When a picture is asked for, Then the answer is the same 404 with no body, so the id tells nothing',
  async (_, path) => {
    const response = await get(path, null)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  },
)

test('F28-AC49: Given an owner with no picture, When it is asked for, Then the answer is a 404 the page hides, so the initial shows', async () => {
  const response = await get(`/avatars/${OWNER_ID}`, null)
  expect(response.status).toBe(404)
  const profile = await (await get('/@owner', null)).text()
  expect(profile).toContain('portrait-initial')
  expect(profile).toContain('>O<')
})

test('F28-AC46: Given an uploaded picture, When it is removed, Then the row and the object go and the picture is asked for no more', async () => {
  await upload(png(20, 20))
  const removed = await server.fetch(
    new Request(new URL('/settings/picture/remove', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
    }),
    env,
  )
  expect(removed.status).toBe(303)
  expect(removed.headers.get('location')).toBe(
    '/settings?saved=picture-removed#profile',
  )
  expect(await stored()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
  expect((await get(`/avatars/${OWNER_ID}`)).status).toBe(404)
  const page = await (await get('/settings?saved=picture-removed')).text()
  expect(page).toContain('アップロードしたプロフィール画像を外しました。')
  expect(page).not.toContain('アップロードしたプロフィール画像を外す</button>')
})

test('F28-AC46: Given no uploaded picture, When settings are opened, Then there is nothing to remove', async () => {
  const page = await (await get('/settings')).text()
  expect(page).not.toContain('アップロードしたプロフィール画像を外す')
  expect(page).toContain('画像をアップロード')
})

test('F28-AC49: Given a row that names a picture whose object is gone, When it is asked for, Then it is a 404 and not an error', async () => {
  await db.insert(profilePictures).values({ user_id: OWNER_ID, uploaded_at: 1 })
  expect((await get(`/avatars/${OWNER_ID}`)).status).toBe(404)
})

test('Given no sign-in or another origin, When a picture is posted or removed, Then nothing changes', async () => {
  const anonymous = await upload(png(10, 10), {}, '')
  expect(anonymous.status).toBe(401)
  const crossSite = await upload(png(10, 10), {
    headers: { Origin: 'https://evil.example' },
  })
  expect(crossSite.status).toBe(403)
  expect(await stored()).toEqual([])
  const remove = await server.fetch(
    new Request(new URL('/settings/picture/remove', TEST_ORIGIN), {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN },
    }),
    env,
  )
  expect(remove.status).toBe(401)
})

test('F28-AC45: Given no Images binding, When a JPEG is uploaded, Then it is refused with 503 and a plain message, and nothing is stored, not even the original', async () => {
  const bare = { ...env, IMAGES: undefined } as unknown as Env
  const form = new FormData()
  form.set('picture', new File([fakeJpeg(2000) as BlobPart], 'face.jpg'))
  const response = await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: form,
    }),
    bare,
  )
  expect(response.status).toBe(503)
  const page = await response.text()
  expect(page).toContain('サービス側の準備が整うまで')
  expect(page).not.toMatch(/binding|Images/)
  expect(await stored()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
})

test('F28-AC45: Given an environment with no Images binding, When a valid PNG is uploaded, Then it is refused with 503 and nothing is stored', async () => {
  const bare = { ...env, IMAGES: undefined } as unknown as Env
  const form = new FormData()
  form.set('picture', new File([png(20, 20) as BlobPart], 'face.png'))
  const response = await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: form,
    }),
    bare,
  )
  expect(response.status).toBe(503)
  expect(await stored()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
})

test.each([
  ['a JPEG', 'image/jpeg', 'face.jpg'],
  ['a WebP', 'image/webp', 'face.webp'],
] as const)(
  'F28-AC44: Given %s cut short, When it is uploaded, Then it is refused as unreadable and nothing is stored',
  async (_, format, name) => {
    const whole = await convert(png(300, 200), format)
    const response = await upload(
      whole.subarray(0, Math.floor(whole.length / 2)),
      {
        name,
      },
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('画像として読めませんでした。')
    expect(await stored()).toEqual([])
  },
)

test('F28-AC44: Given a JPEG signature followed by filler, When it is uploaded, Then it is refused as unreadable', async () => {
  const response = await upload(fakeJpeg(2000), { name: 'face.jpg' })
  expect(response.status).toBe(400)
  expect(await stored()).toEqual([])
})

test('F28-AC43: Given a JPEG over 1 MB, When it is uploaded, Then it is refused as too large', async () => {
  const response = await upload(fakeJpeg(PICTURE_MAX_BYTES + 1), {
    name: 'big.jpg',
  })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('画像は 1 MB までです。')
})
