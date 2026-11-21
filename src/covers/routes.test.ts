import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeployment,
  seedPublic,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
await applyMigrations(db)

/**
 * Stands in for the browser binding: these tests cover which requests reach
 * it and what is made of its answers, not that a real browser draws a deck.
 */
function browserOf(answer: () => Response | Promise<Response>) {
  const asked: { url?: string }[] = []
  const env = {
    ...testEnv(platform.env),
    CONTENT_ORIGIN: 'https://content.example',
    BROWSER: {
      shoot: async (options: { url?: string }) => {
        asked.push(options)
        return answer()
      },
    },
  } as unknown as Env
  return { env, asked }
}
const image = () =>
  new Response('jpeg bytes', { headers: { 'Content-Type': 'image/jpeg' } })
const cover = (env: Env, id: string, init?: RequestInit) =>
  server.fetch(new Request(`${TEST_ORIGIN}/covers/${id}.jpg`, init), env)

beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

test('Given a public deck, When its cover is asked for, Then the browser is shown the deployment origin and its image is returned', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)

  const response = await cover(env, id)

  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(response.headers.get('Cache-Control')).toBe('no-cache')
  expect(response.headers.get('ETag')).toBe(`W/"cover-v1-${id}"`)
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(await response.text()).toBe('jpeg bytes')
  expect(asked.map((options) => options.url)).toEqual([
    `https://d-${id}.content.example/`,
  ])
})

test('F05-AC22: Given a public deck, When its cover is asked for, Then other sites may embed the image', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env } = browserOf(image)

  const response = await cover(env, id)

  expect(response.status).toBe(200)
  expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
    'cross-origin',
  )
})

test('F05-AC22: Given a public deck whose cover a reader holds, When it is revalidated and when only its headers are asked for, Then other sites may embed it', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env } = browserOf(image)

  const revalidated = await cover(env, id, {
    headers: { 'If-None-Match': `W/"cover-v1-${id}"` },
  })
  const head = await cover(env, id, { method: 'HEAD' })

  expect(revalidated.status).toBe(304)
  expect(revalidated.headers.get('Cross-Origin-Resource-Policy')).toBe(
    'cross-origin',
  )
  expect(head.status).toBe(200)
  expect(head.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
})

test('F05-AC22: Given a cover that is not found or cannot be taken, When it is asked for, Then the answer keeps the management baseline', async () => {
  const stopped = await seedPublic(db, 'gone', 100, 'Gone')
  await db.prepare('UPDATE decks SET public_deployment_id = NULL').run()
  const open = await seedPublic(db, 'talk', 101, 'Talk')
  const failing = browserOf(() => {
    throw new Error('no browser')
  })

  const notFound = await cover(browserOf(image).env, stopped)
  const unavailable = await cover(failing.env, open)

  expect(notFound.status).toBe(404)
  expect(notFound.headers.get('Cross-Origin-Resource-Policy')).toBe(
    'same-origin',
  )
  expect(unavailable.status).toBe(503)
  expect(unavailable.headers.get('Cross-Origin-Resource-Policy')).toBe(
    'same-origin',
  )
})

test('F05-AC21: Given a deck that was stopped, When its old cover is asked for, Then it is not found and no browser runs', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  await drizzle(db)
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'talk'))
  const { env, asked } = browserOf(image)

  const response = await cover(env, id)

  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(asked).toEqual([])
})

test('Given a ready deployment that is not the public one, When its cover is asked for, Then it is not found', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const draft = await seedDeployment(db, 'talk')
  const { env, asked } = browserOf(image)

  expect((await cover(env, draft)).status).toBe(404)
  expect(asked).toEqual([])
})

test.each([
  ['an unknown deployment', '7ae11c67-633f-4f21-b2b1-80af84107428'],
  ['a name that is no deployment ID', 'talk'],
])(
  'Given %s, When its cover is asked for, Then it is not found and no browser runs',
  async (_case, id) => {
    const { env, asked } = browserOf(image)

    expect((await cover(env, id)).status).toBe(404)
    expect(asked).toEqual([])
  },
)

test.each([
  ['is over its budget', () => new Response('{}', { status: 429 })],
  ['fails', () => new Response('{}', { status: 500 })],
  ['draws nothing', () => new Response(new Uint8Array(0))],
  [
    'throws',
    () => {
      throw new Error('no browser')
    },
  ],
])(
  'Given a browser that %s, When a cover is asked for, Then the reader is told to retry and keeps nothing',
  async (_case, answer) => {
    const id = await seedPublic(db, 'talk', 100, 'Talk')
    const { env } = browserOf(answer)

    const response = await cover(env, id)

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Retry-After')).toBe('60')
  },
)

test('Given no content origin, When a cover is asked for, Then it is not found', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)

  const response = await cover(
    { ...env, CONTENT_ORIGIN: undefined } as unknown as Env,
    id,
  )

  expect(response.status).toBe(404)
  expect(asked).toEqual([])
})

test('Given a public deck, When its cover is posted to, Then it is not found and no browser runs', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)

  const response = await cover(env, id, { method: 'POST' })

  expect(response.status).toBe(404)
  expect(asked).toEqual([])
})

test('Given a public deck, When only the headers of its cover are asked for, Then they are given and no browser runs', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)

  const response = await cover(env, id, { method: 'HEAD' })

  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(await response.text()).toBe('')
  expect(asked).toEqual([])
})

test('Given a reader who holds a public deck’s cover, When it is revalidated, Then it is confirmed without a browser', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)
  const first = await cover(env, id)

  const again = await cover(env, id, {
    headers: { 'If-None-Match': first.headers.get('ETag') ?? '' },
  })

  expect(again.status).toBe(304)
  // The site adds no-transform to every 304.
  expect(again.headers.get('Cache-Control')).toContain('no-cache')
  expect(asked).toHaveLength(1)
})

test('Given a reader who holds the cover of a deck that was then stopped, When it is revalidated, Then it is not found', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env } = browserOf(image)
  const first = await cover(env, id)
  await drizzle(db)
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'talk'))

  const again = await cover(env, id, {
    headers: { 'If-None-Match': first.headers.get('ETag') ?? '' },
  })

  expect(again.status).toBe(404)
  expect(again.headers.get('Cache-Control')).toBe('no-store')
})

test('F05-AC18: Given a browser that cannot be opened, When a cover is asked for, Then the reader is told to retry soon and nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env } = browserOf(image)
  ;(env.BROWSER as unknown as { launchFails: boolean }).launchFails = true

  const response = await cover(env, id)

  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Retry-After')).toBe('5')
})
