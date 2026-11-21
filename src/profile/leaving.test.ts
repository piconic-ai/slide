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
import { profileLinks, profilePictures, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { png } from './test-picture'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env) as unknown as Env
const bucket = platform.env.UPLOADS
let cookie = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(new Uint8Array([9, 9, 9]), {
        headers: { 'Content-Type': 'image/png' },
      }),
  )
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  expect(cookie).not.toBe('')
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const post = (path: string, body?: BodyInit) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body,
    }),
    env,
  )
const keys = async () =>
  (await bucket.list()).objects
    .map(({ key }) => key)
    .filter((key) => /^(avatars|gravatar)\//.test(key))

test('F28-AC52: Given an uploaded picture, a kept Gravatar picture, links and a profile, When the author leaves, Then every one of them is gone from R2 and D1', async () => {
  const form = new FormData()
  form.set('picture', new File([png(30, 30) as BlobPart], 'face.png'))
  expect((await post('/settings/picture', form)).status).toBe(303)
  await post(
    '/settings/profile',
    new URLSearchParams([
      ['name', 'Owner'],
      ['link', 'https://example.com/a'],
    ]),
  )
  // Turn the upload off to cache the Gravatar picture too: ask for it by
  // first removing the upload, then writing the cache by asking for the face.
  await post('/settings/picture/remove')
  await server.fetch(
    new Request(new URL(`/avatars/${OWNER_ID}`, TEST_ORIGIN)),
    env,
  )
  await post('/settings/picture', form)
  expect(await keys()).toEqual([`avatars/${OWNER_ID}`, `gravatar/${OWNER_ID}`])
  expect(await db.select().from(profileLinks)).toHaveLength(1)

  const left = await post(
    '/account/delete',
    new URLSearchParams({ confirm: 'owner' }),
  )
  expect(left.status).toBe(303)

  expect(await keys()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
  expect(await db.select().from(profileLinks)).toEqual([])
  expect(await db.select().from(profiles)).toEqual([])
  const face = await server.fetch(
    new Request(new URL(`/avatars/${OWNER_ID}`, TEST_ORIGIN)),
    env,
  )
  expect(face.status).toBe(404)
})

test('F28-AC52: Given another author’s picture, When one author leaves, Then the other’s picture stays', async () => {
  const other = await signIn(env, 'other', { id: '555', name: 'Other' })
  const form = () => {
    const f = new FormData()
    f.set('picture', new File([png(30, 30) as BlobPart], 'face.png'))
    return f
  }
  await post('/settings/picture', form())
  await server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: other, Origin: TEST_ORIGIN },
      body: form(),
    }),
    env,
  )
  await post('/account/delete', new URLSearchParams({ confirm: 'owner' }))
  expect(await keys()).toEqual(['avatars/555'])
})

test('F28-AC52: Given an author with no picture, When they leave, Then leaving works', async () => {
  const left = await post(
    '/account/delete',
    new URLSearchParams({ confirm: 'owner' }),
  )
  expect(left.status).toBe(303)
})
