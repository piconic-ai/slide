import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let cookie = ''
let talk = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  cookie = await signIn(env)
  talk = await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(() => platform.dispose())

const html = async (path: string) => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
  expect(response.status).toBe(200)
  return response.text()
}

/** The cover layers in a page: the name face, then the image over it. */
const covers = (page: string) =>
  [
    ...page.matchAll(
      /class="deck-cover">\s*<span class="deck-cover-name"[^>]*>([^<]*)<\/span>\s*<img\s+data-cover\s+src="([^"]+)"/g,
    ),
  ].map(([, name, src]) => ({ name, src }))

test('F03-AC43: Given a public deck that names no image, When its author’s profile opens, Then its card carries the deck’s name and the service’s image of its first slide', async () => {
  expect(covers(await html('/@owner'))).toEqual([
    { name: 'Talk', src: `/covers/${talk}.jpg` },
  ])
})

test('F03-AC44: Given a public deck that names no image, When the author opens the slide list, Then its card carries the deck’s name and the service’s image of its first slide', async () => {
  expect(covers(await html('/my/slides'))).toEqual([
    { name: 'Talk', src: `/covers/${talk}.jpg` },
  ])
})
