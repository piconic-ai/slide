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
import { pictureRemovals, profilePictures } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { squarePng } from '../profile/test-picture'
import { REMOVAL_REASON_MAX } from '../profile/picture-removal'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env
let owner = ''
let other = ''

const gravatar = vi.fn<(url: string) => Promise<Response>>()

beforeAll(async () => {
  await applyMigrations(database)
  await resetTables(database)
  owner = await signIn(env, 'owner', { name: 'Owner' })
  other = await signIn(env, 'other', { id: INVITED_ID, name: 'Other' })
  expect(owner).not.toBe('')
})
beforeEach(async () => {
  vi.stubGlobal('fetch', (url: string) => gravatar(String(url)))
  gravatar.mockReset()
  gravatar.mockImplementation(async () => new Response('', { status: 404 }))
  await db.delete(pictureRemovals)
  await db.delete(profilePictures)
  for (const prefix of ['avatars/', 'gravatar/']) {
    const listed = await platform.env.UPLOADS.list({ prefix })
    await platform.env.UPLOADS.delete(listed.objects.map(({ key }) => key))
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const upload = (cookie: string) => {
  const form = new FormData()
  form.set('picture', new File([squarePng() as BlobPart], 'face.png'))
  return server.fetch(
    new Request(new URL('/settings/picture', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: form,
    }),
    env,
  )
}
const face = (id = OWNER_ID) =>
  server.fetch(new Request(new URL(`/avatars/${id}`, TEST_ORIGIN)), env)
const stored = async () =>
  (await platform.env.UPLOADS.list({ prefix: 'avatars/' })).objects.map(
    ({ key }) => key,
  )

async function post(
  fields: Record<string, string>,
  options: { token?: boolean; origin?: string | null; email?: string } = {},
) {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  if (options.token !== false)
    headers.set(
      ACCESS_TOKEN_HEADER,
      await team.sign({ email: options.email ?? 'op@example.com' }),
    )
  if (options.origin !== null)
    headers.set('Origin', options.origin ?? OPERATOR_ORIGIN)
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}/pictures/remove`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
}
const remove = (target = '@owner', reason = 'not a picture of the author') =>
  post({ target, reason })

test('F28-AC51: Given an author with an uploaded picture, When the operator removes it with a reason, Then the picture is gone from R2 and D1, and the face is no longer the upload', async () => {
  await upload(owner)
  const uploaded = await face()
  expect(uploaded.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(squarePng())
  const response = await remove()
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/?result=picture_removed')
  expect(await stored()).toEqual([])
  expect(await db.select().from(profilePictures)).toEqual([])
  expect((await face()).status).toBe(404)
})

test('F28-AC101: Given an uploaded picture shown on the profile, When the operator removes it, Then the profile shows the face under a new address', async () => {
  await upload(owner)
  const address = async () =>
    /portrait-image[\s\S]*?src="(\/avatars\/[^"]+)"/.exec(
      await (
        await server.fetch(new Request(new URL('/@owner', TEST_ORIGIN)), env)
      ).text(),
    )?.[1]
  const before = await address()
  expect(before).toMatch(/\?v=u\d+$/)
  expect((await remove()).status).toBe(303)
  const after = await address()
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
})

test('F28-AC51: Given a picture the operator removed, When Gravatar has a picture, Then the face is the Gravatar picture', async () => {
  await upload(owner)
  gravatar.mockImplementation(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      }),
  )
  await remove()
  const response = await face()
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
})

test('F28-AC51: Given a removal, When the record is read, Then it names the verified operator, the reason and the time, and survives the author uploading again', async () => {
  await upload(owner)
  const before = Math.floor(Date.now() / 1000)
  await post({
    target: '@owner',
    reason: '  unfit picture  ',
    operator: 'forged@example.com',
    removed_by: 'forged@example.com',
  })
  const [record] = await db.select().from(pictureRemovals)
  expect(record).toMatchObject({
    user_id: OWNER_ID,
    removed_by: 'op@example.com',
    reason: 'unfit picture',
  })
  expect(record!.removed_at).toBeGreaterThanOrEqual(before)
  await upload(owner)
  expect(await db.select().from(pictureRemovals)).toHaveLength(1)
})

test('F28-AC51: Given the operator’s page, When it is opened, Then it offers the form for removing a picture, and says what happens', async () => {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/?result=picture_removed`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  const page = await response.text()
  expect(page).toContain('action="/pictures/remove"')
  expect(page).toContain('プロフィール画像を外す')
  expect(page).toContain('アップロードしたプロフィール画像を外しました。')
})

test.each([
  ['an empty reason', { target: '@owner', reason: '   ' }, 'invalid_reason'],
  ['no reason', { target: '@owner' }, 'invalid_reason'],
  [
    'a reason that is too long',
    { target: '@owner', reason: 'a'.repeat(REMOVAL_REASON_MAX + 1) },
    'invalid_reason',
  ],
  ['no target', { reason: 'x' }, 'invalid_target'],
  [
    'a target that is not a profile',
    { target: '@owner/talk', reason: 'x' },
    'invalid_target',
  ],
  [
    'an account that does not exist',
    { target: '@nobody', reason: 'x' },
    'not_found',
  ],
])(
  'F28-AC51: Given %s, When the operator removes a picture, Then nothing changes and the reason is shown',
  async (_, fields, result) => {
    await upload(owner)
    const response = await post(fields)
    expect(response.headers.get('Location')).toBe(`/?result=${result}`)
    expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
    expect(await db.select().from(pictureRemovals)).toEqual([])
  },
)

test('F28-AC51: Given the longest reason, When the operator removes a picture, Then it is accepted', async () => {
  await upload(owner)
  const response = await post({
    target: '@owner',
    reason: 'a'.repeat(REMOVAL_REASON_MAX),
  })
  expect(response.headers.get('Location')).toBe('/?result=picture_removed')
})

test('F28-AC51: Given a person with no uploaded picture, When the operator removes it, Then it is said so, and no record is written', async () => {
  const response = await remove('@owner')
  expect(response.headers.get('Location')).toBe('/?result=no_picture')
  expect(await db.select().from(pictureRemovals)).toEqual([])
})

test('F28-AC51: Given two authors, When the operator removes one picture, Then the other keeps theirs; a profile URL names the same account as a handle', async () => {
  await upload(owner)
  await upload(other)
  await remove(`${TEST_ORIGIN}/@owner`)
  expect(await stored()).toEqual([`avatars/${INVITED_ID}`])
  expect((await face(INVITED_ID)).status).toBe(200)
})

test('F28-AC51: Given no Access token or another origin, When a removal is posted, Then it is answered as nothing and changes nothing', async () => {
  await upload(owner)
  expect(
    (await post({ target: '@owner', reason: 'x' }, { token: false })).status,
  ).toBe(404)
  expect(
    (
      await post(
        { target: '@owner', reason: 'x' },
        { origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403)
  expect(
    (await post({ target: '@owner', reason: 'x' }, { origin: null })).status,
  ).toBe(403)
  expect(await stored()).toEqual([`avatars/${OWNER_ID}`])
})

test('F28-AC51: Given the author’s own session on the management host, When the operator path is tried there, Then it is not served', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/pictures/remove`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
      body: new URLSearchParams({ target: '@owner', reason: 'x' }),
    }),
    env,
  )
  expect(response.status).toBe(404)
})
