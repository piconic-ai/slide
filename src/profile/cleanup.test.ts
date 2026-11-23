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
import { profilePictures } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { removePictureAsOperator } from './picture-removal-store'
import { removePicture, savePicture } from './picture-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const bucket = platform.env.UPLOADS
const db = drizzle(database)
const env = testEnv(platform.env) as unknown as Env
let cookie = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  for (const prefix of ['avatars/', 'gravatar/']) {
    const listed = await bucket.list({ prefix })
    await bucket.delete(listed.objects.map(({ key }) => key))
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const keys = async () =>
  (await bucket.list()).objects
    .map(({ key }) => key)
    .filter((key) => /^(avatars|gravatar)\//.test(key))
    .sort()

const saveProfile = (fields: [string, string][]) =>
  server.fetch(
    new Request(new URL('/settings/profile', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: new URLSearchParams(fields),
    }),
    env,
  )
const face = () =>
  server.fetch(new Request(new URL(`/avatars/${OWNER_ID}`, TEST_ORIGIN)), env)

/** A D1 whose writes to the picture table fail, as a database going away would. */
const failingPictureWrites = (real: D1Database): D1Database =>
  new Proxy(real, {
    get(target, property) {
      if (property !== 'prepare') return Reflect.get(target, property)
      return (query: string) => {
        if (/insert into "profile_pictures"/i.test(query))
          throw new Error('database unavailable')
        return target.prepare(query)
      }
    },
  })

const picture = {
  userId: OWNER_ID,
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/webp',
  now: 5,
}

test('F28-AC89: Given a Gravatar picture kept for a person, When they turn Gravatar off, Then what was kept goes, and it comes back only if they turn it on and it is asked for', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(new Uint8Array([9]), {
        headers: { 'Content-Type': 'image/png' },
      }),
  )
  expect((await face()).status).toBe(200)
  expect(await keys()).toEqual([`gravatar/${OWNER_ID}`])
  // Saved again with Gravatar still on: what was kept stays.
  await saveProfile([
    ['name', 'Owner'],
    ['gravatar', '1'],
  ])
  expect(await keys()).toEqual([`gravatar/${OWNER_ID}`])
  await saveProfile([
    ['name', 'Owner'],
    ['gravatar', '0'],
  ])
  expect(await keys()).toEqual([])
  expect((await face()).status).toBe(404)
  expect(await keys()).toEqual([])
  await saveProfile([
    ['name', 'Owner'],
    ['gravatar', '1'],
  ])
  expect((await face()).status).toBe(200)
  expect(await keys()).toEqual([`gravatar/${OWNER_ID}`])
})

test('F28-AC88: Given the picture row cannot be written, When a first picture is saved, Then the object is taken away again and the failure is raised', async () => {
  await expect(
    savePicture({ database: failingPictureWrites(database), bucket }, picture),
  ).rejects.toThrow('database unavailable')
  expect(await keys()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
})

test('F28-AC88: Given an author with a picture, When a replacement cannot be recorded, Then the failure is raised and one object remains', async () => {
  await savePicture({ database, bucket }, picture)
  await expect(
    savePicture(
      { database: failingPictureWrites(database), bucket },
      { ...picture, bytes: new Uint8Array([4, 5, 6]), now: 9 },
    ),
  ).rejects.toThrow()
  expect(await keys()).toEqual([`avatars/${OWNER_ID}`])
  expect((await db.select().from(profilePictures))[0]?.uploaded_at).toBe(5)
})

test('F28-AC88: Given an object that no row names (left by a failure), When the author removes their picture, Then it is taken away', async () => {
  await bucket.put(`avatars/${OWNER_ID}`, new Uint8Array([1]))
  expect(await removePicture({ database, bucket }, OWNER_ID)).toBe(false)
  expect(await keys()).toEqual([])
})

test('F28-AC88: Given an object that no row names, When the operator removes the picture, Then it says there was none, and the object is taken away all the same', async () => {
  await bucket.put(`avatars/${OWNER_ID}`, new Uint8Array([1]))
  const result = await removePictureAsOperator(
    { database, bucket },
    { userId: OWNER_ID, operator: 'op@example.com', reason: 'x', now: 1 },
  )
  expect(result).toBe('no_picture')
  expect(await keys()).toEqual([])
})

test('F28-AC88: Given a replaced picture, When it was uploaded twice, Then one object and one row remain', async () => {
  await savePicture({ database, bucket }, picture)
  await savePicture({ database, bucket }, { ...picture, now: 8 })
  expect(await keys()).toEqual([`avatars/${OWNER_ID}`])
  expect(await db.select().from(profilePictures)).toHaveLength(1)
})
