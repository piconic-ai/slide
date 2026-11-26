import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { profilePictures, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  seedPerson,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { PICTURE_PNG_MAX_BYTES } from './picture-policy'
import { cleanPicturePng } from './picture-png'
import {
  chunkTypes,
  png,
  pngChunk,
  pngHeader,
  pngOf,
  pngPixels,
  squarePng,
} from './test-picture'

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

const storedBytes = async () => {
  const object = await platform.env.UPLOADS.get(`avatars/${OWNER_ID}`)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}
const ascii = (text: string) => new TextEncoder().encode(text)
const NOT_ACCEPTED = 'この画像は受け付けられませんでした。'

test('F28-AC41: Given the 256 by 256 PNG the page sends, When it is uploaded, Then the header, the profile and the viewer’s author all draw the picture served at the owner’s id, as a PNG', async () => {
  const response = await upload(squarePng())
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(
    '/settings?saved=picture#profile',
  )
  // The header reads the session, which names the picture.
  const session = (await (await get('/api/session')).json()) as {
    avatarUrl: string
  }
  const path = session.avatarUrl
  expect(path).toMatch(new RegExp(`^/avatars/${OWNER_ID}\\?v=u\\d+$`))
  const profile = await (await get('/@owner')).text()
  expect(profile).toContain(`src="${path}"`)
  const picture = await get(path)
  expect(picture.status).toBe(200)
  expect(picture.headers.get('content-type')).toBe('image/png')
  expect(picture.headers.get('x-content-type-options')).toBe('nosniff')
  const served = new Uint8Array(await picture.arrayBuffer())
  expect(Buffer.from(served).equals(Buffer.from(squarePng()))).toBe(true)
})

test('F28-AC41: Given an uploaded picture, When a slide of the author is opened, Then the viewer’s author row draws it', async () => {
  // The viewer reads the author's profile the same way the profile page does.
  await upload(squarePng())
  await seedPublic(database, 'talk', 1, 'A talk')
  const viewer = await (await get('/@owner/talk', null)).text()
  expect(viewer).toMatch(new RegExp(`src="/avatars/${OWNER_ID}\\?v=u\\d+"`))
})

test('F28-AC41: Given a settings page, When the picture is uploaded, Then the preview there is the new address, one that changes with each upload', async () => {
  await upload(squarePng())
  const page = await (await get('/settings?saved=picture')).text()
  expect(page).toMatch(new RegExp(`src="/avatars/${OWNER_ID}\\?v=u\\d+"`))
  expect(page).toContain('プロフィール画像を変えました。')
})

/** The address of the owner's face in each place that shows it. */
async function faceAddresses() {
  const session = (await (await get('/api/session')).json()) as {
    avatarUrl: string
  }
  const src = (page: string, marker: string) =>
    new RegExp(`${marker}[\\s\\S]*?src="(/avatars/[^"]+)"`).exec(page)?.[1]
  return {
    header: session.avatarUrl,
    profile: src(await (await get('/@owner')).text(), 'portrait-image'),
    viewer: src(await (await get('/@owner/faces', null)).text(), 'data-cover'),
    settings: src(await (await get('/settings')).text(), 'settings-face'),
  }
}

// Five changes, each drawing four pages, take under a second here but passed
// five seconds on a loaded CI shard (main, 2026-11-26).
test('F28-AC101: Given a picture shown in the header, the profile, the viewer’s author and settings, When it is replaced twice, removed, and uploaded again, each a millisecond after the last, Then every place shows one address, and it is new each time', async () => {
  await seedPublic(database, 'faces', 1, 'Faces')
  // The clock of this process, which the service reads for "now", set a
  // millisecond on before each change: all of them fall in one second.
  const start = Date.UTC(2026, 10, 25)
  vi.useFakeTimers({ toFake: ['Date'], now: start })
  try {
    const seen = new Set<string>()
    const changes = [
      () => upload(squarePng()),
      () => upload(png(256, 256)),
      () => upload(squarePng()),
      () =>
        server.fetch(
          new Request(new URL('/settings/picture/remove', TEST_ORIGIN), {
            method: 'POST',
            headers: { Cookie: cookie, Origin: TEST_ORIGIN },
          }),
          env,
        ),
      () => upload(squarePng()),
    ]
    for (const [index, change] of changes.entries()) {
      vi.setSystemTime(start + index)
      expect((await change()).status).toBe(303)
      const { header, profile, viewer, settings } = await faceAddresses()
      expect([profile, viewer, settings]).toEqual([header, header, header])
      expect(seen.has(header)).toBe(false)
      seen.add(header)
    }
    expect(seen.size).toBe(5)
  } finally {
    vi.useRealTimers()
  }
}, 30_000)

test.each([
  [
    'its own version',
    (path: string) => path,
    'public, max-age=31536000, immutable',
  ],
  ['no version', (path: string) => path.split('?')[0]!, 'no-cache'],
  [
    'an earlier version',
    (path: string) => path.replace(/u(\d+)$/, (_, at) => `u${Number(at) - 1}`),
    'no-cache',
  ],
  [
    'a version of another kind',
    (path: string) => path.replace(/v=.*$/, 'v=g'),
    'no-cache',
  ],
  [
    'a version twice',
    (path: string) => `${path}&v=n`,
    'public, max-age=31536000, immutable',
  ],
])(
  'F28-AC101: Given an uploaded picture, When it is asked for under %s, Then the picture is served and may be kept as the answer says',
  async (_, address, cacheControl) => {
    await upload(squarePng())
    const session = (await (await get('/api/session')).json()) as {
      avatarUrl: string
    }
    const response = await get(address(session.avatarUrl), null)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(cacheControl)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(
      Buffer.from(await response.arrayBuffer()).equals(
        Buffer.from(squarePng()),
      ),
    ).toBe(true)
  },
)

test('F28-AC101: Given no picture to serve, When it is asked for under any version, Then the 404 is asked for again each time', async () => {
  // Gravatar is off, so nothing is asked of it.
  await db.update(profiles).set({ use_gravatar: 0 })
  try {
    for (const path of [
      `/avatars/${OWNER_ID}?v=n`,
      `/avatars/${OWNER_ID}?v=u1`,
      `/avatars/${OWNER_ID}`,
      `/avatars/nobody?v=n`,
    ]) {
      const response = await get(path, null)
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-cache')
    }
  } finally {
    await db.update(profiles).set({ use_gravatar: 1 })
  }
})

const brokenCrc = () => {
  const bytes = squarePng()
  bytes[bytes.length - 20] ^= 0xff
  return bytes
}

test.each([
  [
    'a JPEG',
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]),
    'face.jpg',
  ],
  ['a WebP', ascii('RIFF\x10\x00\x00\x00WEBPVP8 ......'), 'face.webp'],
  ['a GIF', ascii('GIF89a' + 'x'.repeat(40)), 'face.gif'],
  [
    'an SVG',
    ascii(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
    'face.svg',
  ],
  ['HTML named .png', ascii('<!doctype html><title>x</title>'), 'face.png'],
  ['a PNG of 300 by 200', png(300, 200), 'face.png'],
  ['a PNG of 255 by 256', png(255, 256), 'face.png'],
  ['a PNG with a broken CRC', brokenCrc(), 'face.png'],
  [
    'a PNG with HTML after its end',
    Uint8Array.from([...squarePng(), ...ascii('<script>alert(1)</script>')]),
    'face.png',
  ],
  ['a PNG cut short', squarePng().subarray(0, 60), 'face.png'],
] as const)(
  'F28-AC97: Given %s, When it is posted, Then it is refused with the reason and nothing is stored',
  async (_, data, name) => {
    const response = await upload(data, { name })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(NOT_ACCEPTED)
    expect(await stored()).toEqual([])
    expect(await db.select().from(profilePictures)).toEqual([])
  },
)

test('F28-AC97: Given a 256 by 256 PNG one byte over 512 KB, When it is posted, Then it is refused and nothing is stored', async () => {
  const filler = PICTURE_PNG_MAX_BYTES - squarePng().length - 11
  const big = pngOf(
    pngChunk('IHDR', pngHeader(256, 256)),
    pngChunk('zzZz', new Uint8Array(filler)),
    pngChunk('IDAT', pngPixels(256, 256)),
    pngChunk('IEND'),
  )
  expect(big.length).toBe(PICTURE_PNG_MAX_BYTES + 1)
  const response = await upload(big)
  expect(response.status).toBe(400)
  expect(await response.text()).toContain(NOT_ACCEPTED)
  expect(await stored()).toEqual([])
})

test('F28-AC97: Given a body that declares itself far over the limit, When it is posted, Then it is refused without being read', async () => {
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
  expect(await response.text()).toContain(NOT_ACCEPTED)
})

test.each([
  ['no file in the form', () => new FormData()],
  [
    'an empty file',
    () => {
      const form = new FormData()
      form.set('picture', new File([], 'face.png'))
      return form
    },
  ],
  [
    'text in place of a file',
    () => {
      const form = new FormData()
      form.set('picture', 'face.png')
      return form
    },
  ],
])(
  'Given %s, When it is posted, Then it is refused asking for an image',
  async (_, form) => {
    const response = await server.fetch(
      new Request(new URL('/settings/picture', TEST_ORIGIN), {
        method: 'POST',
        headers: { Cookie: cookie, Origin: TEST_ORIGIN },
        body: form(),
      }),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('画像を選んでください。')
    expect(await stored()).toEqual([])
  },
)

test('F28-AC98: Given a 256 by 256 PNG carrying text, EXIF and a time, When it is posted, Then the stored picture has none of them, and still reads as the same PNG', async () => {
  const bytes = pngOf(
    pngChunk('IHDR', pngHeader(256, 256)),
    pngChunk('tEXt', ascii('Comment\x00secret place')),
    pngChunk('eXIf', ascii('MM\x00*GPS 35.6895 139.6917')),
    pngChunk('tIME', new Uint8Array(7)),
    pngChunk('sRGB', Uint8Array.from([0])),
    pngChunk('IDAT', pngPixels(256, 256)),
    pngChunk('iTXt', ascii('After\x00\x00\x00\x00\x00secret')),
    pngChunk('IEND'),
  )
  expect((await upload(bytes)).status).toBe(303)
  const kept = await storedBytes()
  expect(kept).not.toBeNull()
  expect(chunkTypes(kept!)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
  const text = Buffer.from(kept!).toString('latin1')
  expect(text).not.toContain('secret')
  expect(text).not.toContain('GPS')
  expect(cleanPicturePng(kept!).kind).toBe('ok')
  const served = await get(`/avatars/${OWNER_ID}`, null)
  expect(
    Buffer.from(await served.arrayBuffer()).equals(Buffer.from(kept!)),
  ).toBe(true)
})

test('F28-AC98: Given an animated PNG of 256 by 256, When it is posted, Then only its still picture is stored', async () => {
  const bytes = pngOf(
    pngChunk('IHDR', pngHeader(256, 256)),
    pngChunk('acTL', new Uint8Array(8)),
    pngChunk('fcTL', new Uint8Array(26)),
    pngChunk('IDAT', pngPixels(256, 256)),
    pngChunk('fdAT', new Uint8Array(40)),
    pngChunk('IEND'),
  )
  expect((await upload(bytes)).status).toBe(303)
  expect(chunkTypes((await storedBytes())!)).toEqual(['IHDR', 'IDAT', 'IEND'])
})

test('F28-AC88: Given a picture, When it is uploaded, Then the PNG is the only object stored for it, under the owner’s key', async () => {
  await upload(squarePng())
  expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
  const object = await platform.env.UPLOADS.get(`avatars/${OWNER_ID}`)
  expect(object?.httpMetadata?.contentType).toBe('image/png')
})

test('F28-AC88: Given a second upload, When it is stored, Then it replaces the first and one picture remains', async () => {
  await upload(squarePng())
  const second = pngOf(
    pngChunk('IHDR', pngHeader(256, 256, { colorType: 6 })),
    pngChunk('IDAT', pngPixels(256, 256)),
    pngChunk('IEND'),
  )
  await upload(second)
  expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
  expect(await db.select().from(profilePictures)).toHaveLength(1)
  expect(Buffer.from((await storedBytes())!).equals(Buffer.from(second))).toBe(
    true,
  )
})

test.each([
  ['WebP', 'image/webp', 'image/webp'],
  ['an object that claims to be HTML', 'text/html', 'image/webp'],
  ['an object with no type', undefined, 'image/webp'],
] as const)(
  'F28-AC100: Given a picture stored before the browser shrank them, as %s, When it is asked for, Then it is served as it is, with a fixed image type and nosniff',
  async (_, contentType, served) => {
    const webp = ascii('RIFF\x10\x00\x00\x00WEBPVP8 old picture')
    await platform.env.UPLOADS.put(`avatars/${OWNER_ID}`, webp, {
      httpMetadata: contentType ? { contentType } : {},
    })
    await db
      .insert(profilePictures)
      .values({ user_id: OWNER_ID, uploaded_at: 1 })
    const response = await get(`/avatars/${OWNER_ID}`, null)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(served)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
    expect(
      Buffer.from(await response.arrayBuffer()).equals(Buffer.from(webp)),
    ).toBe(true)
  },
)

test('F28-AC49: Given another person and a reader who is not signed in, When the owner’s picture is asked for by id, Then it is served, and the answer carries nothing but the image', async () => {
  await upload(squarePng())
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
  await upload(squarePng())
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
})

test('F28-AC99: Given the settings page as served, When it is read before any script runs, Then the file field is disabled, no button sends the form, and the reason for scripts shows only without them', async () => {
  const page = await (await get('/settings')).text()
  const field = page.match(/<input\s[^>]*data-picture-upload[^>]*>/)?.[0] ?? ''
  expect(field).toMatch(/\sdisabled(\s|>)/)
  expect(field).toContain('data-side="256"')
  expect(field).toContain('data-max-side="8192"')
  expect(page).not.toContain('画像をアップロード')
  expect(page).not.toMatch(/<button[^>]*form="picture-upload"/)
  expect(page).toMatch(
    /<noscript\s*><p[^>]*id="picture-no-script"[^>]*>\s*スクリプトが動かないため、プロフィール画像を変えられません。/,
  )
})

test('F28-AC49: Given a row that names a picture whose object is gone, When it is asked for, Then it is a 404 and not an error', async () => {
  await db.insert(profilePictures).values({ user_id: OWNER_ID, uploaded_at: 1 })
  expect((await get(`/avatars/${OWNER_ID}`)).status).toBe(404)
})

test('Given no sign-in or another origin, When a picture is posted or removed, Then nothing changes', async () => {
  const anonymous = await upload(squarePng(), {}, '')
  expect(anonymous.status).toBe(401)
  const crossSite = await upload(squarePng(), {
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
