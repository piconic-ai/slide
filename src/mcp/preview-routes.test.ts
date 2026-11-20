import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { previewLaunches } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = withInvited(testEnv(platform.env))
let alice = ''
let bob = ''
let ready = ''
let receiving = ''
let bobsVersion = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  await seedDeck(database, 'talk', OWNER_ID)
  await seedDeck(database, 'bobs', INVITED_ID, 'secret')
  ready = await seedDeployment(database, 'talk')
  receiving = await seedDeployment(database, 'talk', 'uploading')
  bobsVersion = await seedDeployment(database, 'bobs')
})
afterAll(() => platform.dispose())

const open = (path: string, cookie: string, lang = 'ja') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}?lang=${lang}`, {
      headers: { Cookie: cookie },
    }),
    env,
  )

test('F23-AC4: Given the preview URL a tool returned, When the slide’s author opens it, Then the page offers the author-only preview by the form the manage page sends, and starts nothing itself', async () => {
  const path = `/slides/talk/deployments/${ready}/preview`
  const response = await open(path, alice)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toMatch(
    new RegExp(`<form\\s+method="post"\\s+action="${path}"\\s*>`),
  )
  expect(page).toContain('プレビューを開く')
  expect(page).toContain('この版は、あなただけが見られます。')
  expect(page).toContain('href="/slides/talk"')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  // Opening the link issues no launch; only the posted form does.
  expect(await drizzle(database).select().from(previewLaunches)).toEqual([])
  const english = await (await open(path, alice, 'en')).text()
  expect(english).toContain('Open the preview')
})

test('F23-AC4: Given the preview URL, When someone who is not signed in opens it, Then sign-in is asked for and nothing about the slide is shown', async () => {
  const response = await open(`/slides/talk/deployments/${ready}/preview`, '')
  expect(response.status).toBe(401)
  expect(await response.text()).not.toContain('プレビューを開く')
})

test.each([
  [
    'another author’s slide and version',
    () => `/slides/secret/deployments/${bobsVersion}/preview`,
    () => alice,
  ],
  [
    'the author’s slide with another author’s version',
    () => `/slides/talk/deployments/${bobsVersion}/preview`,
    () => alice,
  ],
  [
    'the author’s own slide, opened by another author',
    () => `/slides/talk/deployments/${ready}/preview`,
    () => bob,
  ],
  [
    'a version that is not ready',
    () => `/slides/talk/deployments/${receiving}/preview`,
    () => alice,
  ],
  [
    'a version that does not exist',
    () =>
      '/slides/talk/deployments/00000000-0000-4000-8000-000000000000/preview',
    () => alice,
  ],
  [
    'an ID that is no ID',
    () => '/slides/talk/deployments/not-an-id/preview',
    () => alice,
  ],
])(
  'F23-AC4: Given %s, When the preview URL is opened, Then it is not found and offers no preview',
  async (_, path, cookie) => {
    const response = await open(path(), cookie())
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('プレビューを開く')
  },
)
