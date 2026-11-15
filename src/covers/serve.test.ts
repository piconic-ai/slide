import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, seedPublic, testEnv } from '../publication/test-support'
import { takeCoverShot } from './serve'
import { coverShotUrl } from './shot'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
await applyMigrations(db)

/** What the internal cache would store is decided by these headers. */
const envWith = (answer: () => Response | Promise<Response>) =>
  ({
    ...testEnv(platform.env),
    CONTENT_ORIGIN: 'https://content.example',
    BROWSER: { quickAction: async () => answer() },
  }) as unknown as Env
const image = () =>
  new Response('jpeg bytes', { headers: { 'Content-Type': 'image/jpeg' } })

beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

test('Given a public deployment, When its cover is taken, Then the image may be kept for good under the deployment’s tag', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')

  const shot = await takeCoverShot(
    envWith(image),
    new Request(coverShotUrl(id)),
  )

  expect(shot.status).toBe(200)
  expect(shot.headers.get('Content-Type')).toBe('image/jpeg')
  expect(shot.headers.get('Cache-Control')).toBe(
    'public, max-age=31536000, immutable',
  )
  expect(shot.headers.get('Cache-Tag')).toBe(`deployment-${id}`)
  expect(await shot.text()).toBe('jpeg bytes')
})

test.each([
  ['is over its budget', () => new Response('{}', { status: 429 })],
  ['fails', () => new Response('{}', { status: 500 })],
  ['answers with no image', () => Response.json({ success: false })],
  [
    'throws',
    () => {
      throw new Error('no browser')
    },
  ],
])(
  'Given a browser that %s, When a cover is taken, Then the failure is kept for a minute only',
  async (_case, answer) => {
    const id = await seedPublic(db, 'talk', 100, 'Talk')

    const shot = await takeCoverShot(
      envWith(answer),
      new Request(coverShotUrl(id)),
    )

    expect(shot.status).toBe(503)
    expect(shot.headers.get('Cache-Control')).toBe('public, max-age=60')
  },
)

test('Given a deck stopped while the browser was open, When the shot comes back, Then it is not kept as the cover', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const stopDuringShot = async () => {
    await drizzle(db)
      .update(decks)
      .set({ public_deployment_id: null })
      .where(eq(decks.id, 'talk'))
    return image()
  }

  const shot = await takeCoverShot(
    envWith(stopDuringShot),
    new Request(coverShotUrl(id)),
  )

  expect(shot.status).toBe(404)
  expect(shot.headers.get('Cache-Control')).toBe('no-store')
})

test.each([
  [
    'another method',
    (id: string) => new Request(coverShotUrl(id), { method: 'POST' }),
  ],
  [
    'a URL that names no deployment',
    () => new Request('https://cover-shots.internal/v1/talk'),
  ],
  ['a query', (id: string) => new Request(`${coverShotUrl(id)}?x=1`)],
])(
  'Given %s, When a cover is taken, Then no browser runs and nothing is kept',
  async (_case, request) => {
    const id = await seedPublic(db, 'talk', 100, 'Talk')
    let asked = 0
    const env = envWith(() => {
      asked += 1
      return image()
    })

    const shot = await takeCoverShot(env, request(id))

    expect(shot.status).toBe(404)
    expect(shot.headers.get('Cache-Control')).toBe('no-store')
    expect(asked).toBe(0)
  },
)
