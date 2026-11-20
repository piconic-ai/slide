import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../../server'
import { decks, deployments, pageScriptDeployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedDeployment,
  seedPublic,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { limitGroupOf } from '../site/rate-limit-policy'
import { takeCoverShot } from './serve-routes'
import {
  coverShotPath,
  MAX_SHOT_PAGE,
  PAGE_SHOTS_PER_MINUTE,
  pageShotPath,
} from './shot'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
await applyMigrations(db)

type Answer = (url: string) => Response | Promise<Response>

/**
 * Stands in for the browser binding: these tests cover which requests reach
 * it and what is made of its answers, not that a real browser draws a page.
 */
function browserOf(answer: Answer) {
  const asked: string[] = []
  // Stands in for the rate limiting binding within one minute: each key
  // passes as often as the configured budget allows.
  const counted = new Map<string, number>()
  const limit = async ({ key }: { key: string }) => {
    counted.set(key, (counted.get(key) ?? 0) + 1)
    return { success: (counted.get(key) ?? 0) <= PAGE_SHOTS_PER_MINUTE }
  }
  const env = {
    ...testEnv(platform.env),
    CONTENT_ORIGIN: 'https://content.example',
    PAGE_SHOT_RATE_LIMITER: { limit },
    BROWSER: {
      shoot: async (options: { url: string }) => {
        asked.push(options.url)
        return answer(options.url)
      },
    },
  } as unknown as Env
  return { env, asked }
}
const image: Answer = (url) =>
  new Response(`jpeg of ${new URL(url).hash || 'the cover'}`, {
    headers: { 'Content-Type': 'image/jpeg' },
  })
const broken = () => new Response('{}', { status: 500 })
/** A browser that takes the first slide but no numbered page. */
const coverOnly: Answer = (url) => (new URL(url).hash ? broken() : image(url))

const pageImage = (
  env: Env,
  id: string,
  page: number | string,
  init?: RequestInit,
  context?: ExecutionContext,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/covers/${id}/${page}.jpg`, init),
    env,
    context,
  )

/** A public deck whose deployment was noted as loading the page script. */
async function seedPaged(deck = 'talk') {
  const id = await seedPublic(db, deck, 100, 'Talk')
  await orm.insert(pageScriptDeployments).values({ deployment_id: id })
  return id
}
const stop = (deck = 'talk') =>
  orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, deck))

beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

test('F05-AC5: Given a public deck that loads the page script, When the image of its page 6 is asked for, Then the browser is shown that page and a JPEG is returned', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(response.headers.get('Cache-Control')).toBe('no-cache')
  expect(response.headers.get('ETag')).toBe(`W/"page-p1-${id}-6"`)
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(await response.text()).toBe('jpeg of #6')
  expect(asked).toEqual([`https://d-${id}.content.example/#6`])
})

test.each([1, 200])(
  'F05-AC5: Given a public deck that loads the page script, When the image of page %i, an end of the range, is asked for, Then it is taken',
  async (page) => {
    const id = await seedPaged()
    const { env, asked } = browserOf(image)

    expect((await pageImage(env, id, page)).status).toBe(200)
    expect(asked).toEqual([`https://d-${id}.content.example/#${page}`])
  },
)

test.each([
  ['past the last page taken', '201'],
  ['zero', '0'],
  ['negative', '-6'],
  ['a fraction', '1.5'],
  ['zero-padded', '06'],
  ['huge', '99999999999999999999'],
  ['no number', 'six'],
  ['empty', ''],
  ['an exponent', '1e2'],
])(
  'F05-AC9: Given a public deck that loads the page script, When the image of a page that is %s is asked for, Then it is not found and no browser runs',
  async (_case, page) => {
    const id = await seedPaged()
    const { env, asked } = browserOf(image)

    const response = await pageImage(env, id, page)

    expect(response.status).toBe(404)
    expect(asked).toEqual([])
  },
)

test('F05-AC8: Given a public deck that does not load the page script, When the image of a page is asked for, Then it is not found and no browser runs', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const { env, asked } = browserOf(image)

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(asked).toEqual([])
})

test.each([
  ['an unknown deployment', '7ae11c67-633f-4f21-b2b1-80af84107428'],
  ['a name that is no deployment ID', 'talk'],
])(
  'Given %s, When the image of a page is asked for, Then it is not found and no browser runs',
  async (_case, id) => {
    const { env, asked } = browserOf(image)

    expect((await pageImage(env, id, 6)).status).toBe(404)
    expect(asked).toEqual([])
  },
)

test('F05-AC10: Given a browser that cannot take a page, When its image is asked for, Then the cover is returned and nothing keeps it as the page', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(coverOnly)

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(await response.text()).toBe('jpeg of the cover')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('ETag')).toBeNull()
  expect(asked).toEqual([
    `https://d-${id}.content.example/#6`,
    `https://d-${id}.content.example/`,
  ])
})

test.each([
  ['fails', broken],
  ['is over its budget', () => new Response('{}', { status: 429 })],
  ['draws nothing', () => new Response(new Uint8Array(0))],
  [
    'throws',
    () => {
      throw new Error('no browser')
    },
  ],
])(
  'F05-AC10: Given a browser that %s for the page and for the cover, When the image of a page is asked for, Then the reader is told to retry as for a cover',
  async (_case, answer) => {
    const id = await seedPaged()
    const { env } = browserOf(answer)

    const response = await pageImage(env, id, 6)

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Retry-After')).toBe('60')
  },
)

test('F05-AC10: Given a deck that names its own cover and a browser that cannot take a page, When the image of the page is asked for, Then the reader is sent to that cover and no first slide is taken', async () => {
  const id = await seedPaged()
  await orm
    .update(deployments)
    .set({ cover_path: 'images/表紙 1.png' })
    .where(eq(deployments.id, id))
  const { env, asked } = browserOf(coverOnly)

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(302)
  expect(response.headers.get('Location')).toBe(
    `https://d-${id}.content.example/images/${encodeURIComponent('表紙 1.png')}`,
  )
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(asked).toEqual([`https://d-${id}.content.example/#6`])
})

test('F05-AC11: Given a deck that was stopped, When the image of its page is asked for, Then it is not found and no browser runs', async () => {
  const id = await seedPaged()
  await stop()
  const { env, asked } = browserOf(image)

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(asked).toEqual([])
})

test('F05-AC11: Given a deck the operator has hidden, When the image of its page is asked for, Then it is not found and no browser runs, until the deck is released', async () => {
  const id = await seedPaged()
  await applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 1,
  })
  const { env, asked } = browserOf(image)

  expect((await pageImage(env, id, 6)).status).toBe(404)
  expect(asked).toEqual([])
  await applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'release' },
    now: 2,
  })
  expect((await pageImage(env, id, 6)).status).toBe(200)
})

test('F05-AC11: Given a deck whose public deployment was replaced, When the image of a page of the old one is asked for, Then it is not found while the new one is taken', async () => {
  const old = await seedPaged()
  const current = await seedDeployment(db, 'talk')
  await orm.insert(pageScriptDeployments).values({ deployment_id: current })
  await orm
    .update(decks)
    .set({ public_deployment_id: current })
    .where(eq(decks.id, 'talk'))
  const { env, asked } = browserOf(image)

  expect((await pageImage(env, old, 6)).status).toBe(404)
  expect(asked).toEqual([])
  expect((await pageImage(env, current, 6)).status).toBe(200)
})

test('F05-AC11: Given a reader who holds the image of a page of a deck that was then stopped, When it is revalidated, Then it is not found', async () => {
  const id = await seedPaged()
  const { env } = browserOf(image)
  const first = await pageImage(env, id, 6)
  await stop()

  const again = await pageImage(env, id, 6, {
    headers: { 'If-None-Match': first.headers.get('ETag') ?? '' },
  })

  expect(again.status).toBe(404)
  expect(again.headers.get('Cache-Control')).toBe('no-store')
})

test('F05-AC11: Given a deck stopped while the browser was open on a page, When the image comes back, Then it is not found and the cover is not given instead', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(async (url) => {
    await stop()
    return image(url)
  })

  const response = await pageImage(env, id, 6)

  expect(response.status).toBe(404)
  expect(asked).toHaveLength(1)
})

test('Given a reader who holds the image of a page, When it is revalidated, Then it is confirmed without a browser, and the image of another page is not', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)
  const first = await pageImage(env, id, 6)
  const held = { 'If-None-Match': first.headers.get('ETag') ?? '' }

  expect((await pageImage(env, id, 6, { headers: held })).status).toBe(304)
  expect(asked).toHaveLength(1)
  expect((await pageImage(env, id, 7, { headers: held })).status).toBe(200)
})

test('Given a public deck that loads the page script, When only the headers of the image of a page are asked for, Then they are given and no browser runs', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)

  const response = await pageImage(env, id, 6, { method: 'HEAD' })

  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(await response.text()).toBe('')
  expect(asked).toEqual([])
})

test('Given a public deck that loads the page script, When the image of a page is posted to, Then it is not found and no browser runs', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)

  expect((await pageImage(env, id, 6, { method: 'POST' })).status).toBe(404)
  expect(asked).toEqual([])
})

/**
 * Stands in for Workers Cache in front of the CoverShots entrypoint. As
 * documented, the key is the request path without the host, requests for a
 * key that is being filled wait for that one answer, and a response is
 * stored only when its Cache-Control allows it. That the real cache does so
 * is not shown here.
 */
function cacheOf(env: Env) {
  const filling = new Map<string, Promise<Response>>()
  const keys: string[] = []
  const fetch = async (request: Request) => {
    const key = new URL(request.url).pathname
    keys.push(key)
    const pending = filling.get(key) ?? takeCoverShot(env, request)
    filling.set(key, pending)
    const response = (await pending).clone()
    if (!/\bpublic\b/.test(response.headers.get('Cache-Control') ?? ''))
      filling.delete(key)
    return response
  }
  const stored = () => [...filling.keys()]
  const context = {
    exports: { CoverShots: { fetch } },
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
  return { context, keys, stored }
}

test('F05-AC12, F05-AC20: Given the internal cache, When the image of one page is asked for twice at once, Then both ask under one key and the browser runs once', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)
  const { context, keys } = cacheOf(env)

  const responses = await Promise.all([
    pageImage(env, id, 6, undefined, context),
    pageImage(env, id, 6, undefined, context),
  ])

  expect(responses.map((response) => response.status)).toEqual([200, 200])
  expect(keys).toEqual([`/p1/${id}/6`, `/p1/${id}/6`])
  expect(asked).toEqual([`https://d-${id}.content.example/#6`])
})

test('F05-AC12: Given the internal cache, When the images of two pages and the cover are asked for at once, Then each has a key of its own and is taken once', async () => {
  const id = await seedPaged()
  const other = await seedPaged('other')
  const { env, asked } = browserOf(image)
  const { context, keys } = cacheOf(env)
  const cover = (deployment: string) =>
    server.fetch(
      new Request(`${TEST_ORIGIN}${coverShotPath(deployment)}`),
      env,
      context,
    )

  await Promise.all([
    pageImage(env, id, 6, undefined, context),
    pageImage(env, id, 7, undefined, context),
    pageImage(env, other, 6, undefined, context),
    cover(id),
  ])

  expect(new Set(keys).size).toBe(4)
  expect([...asked].sort()).toEqual(
    [
      `https://d-${id}.content.example/#6`,
      `https://d-${id}.content.example/#7`,
      `https://d-${other}.content.example/#6`,
      `https://d-${id}.content.example/`,
    ].sort(),
  )
})

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

test.each([
  ['a deck no browser can take', broken, 503],
  ['a deck that can be taken', image, 200],
])(
  'F05-AC19: Given %s, When the images of all 200 of its pages are asked for within a minute, Then the browser is started for only a few of them and the rest show the cover',
  async (_case, answer, coverStatus) => {
    const id = await seedPaged()
    const { env, asked } = browserOf(answer)

    const statuses: number[] = []
    for (const page of range(MAX_SHOT_PAGE))
      statuses.push((await pageImage(env, id, page)).status)

    const pages = asked.filter((url) => new URL(url).hash !== '')
    expect(pages).toHaveLength(PAGE_SHOTS_PER_MINUTE)
    // Past the budget, a page is answered with the cover, or as the cover is.
    expect(new Set(statuses.slice(PAGE_SHOTS_PER_MINUTE))).toEqual(
      new Set([coverStatus]),
    )
  },
  60000,
)

test('Given a deck whose pages used up its budget of new images, When a page of another deck is asked for, Then that page is taken', async () => {
  const id = await seedPaged()
  const other = await seedPaged('other')
  const { env, asked } = browserOf(image)
  for (const page of range(PAGE_SHOTS_PER_MINUTE + 1))
    await pageImage(env, id, page)

  const response = await pageImage(env, other, 6)

  expect(await response.text()).toBe('jpeg of #6')
  expect(asked).toContain(`https://d-${other}.content.example/#6`)
})

test('Given a deck whose pages used up its budget of new images, When its cover is asked for, Then the cover is still taken', async () => {
  const id = await seedPaged()
  const { env } = browserOf(image)
  for (const page of range(PAGE_SHOTS_PER_MINUTE + 1))
    await pageImage(env, id, page)

  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${coverShotPath(id)}`),
    env,
  )

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('jpeg of the cover')
})

test('F05-AC19, F05-AC20: Given the internal cache and a deck whose pages used up its budget, When a page already taken is asked for again, Then it comes from the cache and a page refused for the budget is not kept as failed', async () => {
  const id = await seedPaged()
  const { env, asked } = browserOf(image)
  const { context, stored } = cacheOf(env)
  for (const page of range(PAGE_SHOTS_PER_MINUTE + 1))
    await pageImage(env, id, page, undefined, context)
  const before = asked.length

  const again = await pageImage(env, id, 1, undefined, context)

  expect(await again.text()).toBe('jpeg of #1')
  expect(asked).toHaveLength(before)
  expect(stored()).not.toContain(`/p1/${id}/${PAGE_SHOTS_PER_MINUTE + 1}`)
})

test('Given the Worker configuration, When the budget of new page images is read, Then it is the small per-deployment budget the tests count on', () => {
  const { ratelimits } = unstable_readConfig({ config: 'wrangler.jsonc' })
  const budget = ratelimits?.find(
    (binding: { name: string }) => binding.name === 'PAGE_SHOT_RATE_LIMITER',
  )?.simple

  expect(budget).toEqual({ limit: PAGE_SHOTS_PER_MINUTE, period: 60 })
})

test('F05-AC13: Given the path of the image of a page, When its rate limit is chosen, Then it is the one a cover is counted under', () => {
  const id = '7ae11c67-633f-4f21-b2b1-80af84107428'

  expect(limitGroupOf(pageShotPath(id, 6))).toBe('viewer')
  expect(limitGroupOf(pageShotPath(id, 6))).toBe(
    limitGroupOf(coverShotPath(id)),
  )
})
