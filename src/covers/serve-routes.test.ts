import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, seedPublic, testEnv } from '../publication/test-support'
import { takeCoverShot } from './serve-routes'
import { SHOT_DEADLINE_MS, shotUrl } from './shot'
import type { FakeBrowserBinding } from '../test-browser-setup'

const coverShotUrl = (deploymentId: string) =>
  shotUrl({ kind: 'cover', deploymentId })

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
await applyMigrations(db)

/** What the internal cache would store is decided by these headers. */
const envWith = (answer: () => Response | Promise<Response>) =>
  ({
    ...testEnv(platform.env),
    CONTENT_ORIGIN: 'https://content.example',
    BROWSER: { shoot: async () => answer() },
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

test('F05-AC14: Given a public deployment, When its cover is taken, Then the browser draws a 1280x720 JPEG once the deck settles', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(image)

  await takeCoverShot(env, new Request(coverShotUrl(id)))

  expect((env.BROWSER as unknown as FakeBrowserBinding).seen).toMatchObject({
    viewport: { width: 1280, height: 720 },
    goto: { waitUntil: 'networkidle2', timeout: 15000 },
    screenshot: { type: 'jpeg', quality: 85 },
  })
})

test.each([
  ['draws the cover', image],
  ['fails', () => new Response('{}', { status: 500 })],
  [
    'throws',
    () => {
      throw new Error('no browser')
    },
  ],
])(
  'F05-AC18: Given a browser that %s, When a cover is taken, Then the browser it opened is closed',
  async (_case, answer) => {
    const id = await seedPublic(db, 'talk', 100, 'Talk')
    const env = envWith(answer)
    const binding = env.BROWSER as unknown as FakeBrowserBinding

    await takeCoverShot(env, new Request(coverShotUrl(id)))

    expect(binding.opened).toBe(1)
    expect(binding.closed).toBe(1)
  },
)

test('F05-AC18: Given a deck stopped while the browser was open, When the shot comes back, Then the browser is closed', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(async () => {
    await drizzle(db)
      .update(decks)
      .set({ public_deployment_id: null })
      .where(eq(decks.id, 'talk'))
    return image()
  })

  await takeCoverShot(env, new Request(coverShotUrl(id)))

  expect((env.BROWSER as unknown as FakeBrowserBinding).closed).toBe(1)
})

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

test('F05-AC5, F05-AC16: Given a public deployment, When its page 6 is taken, Then the browser opens that page and the image may be kept for good under the deployment’s tag', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const opened: string[] = []
  const env = {
    ...envWith(image),
    BROWSER: {
      shoot: async (options: { url: string }) => {
        opened.push(options.url)
        return image()
      },
    },
  } as unknown as Env

  const shot = await takeCoverShot(
    env,
    new Request(shotUrl({ kind: 'page', deploymentId: id, page: 6 })),
  )

  expect(shot.status).toBe(200)
  expect(opened).toEqual([`https://d-${id}.content.example/#6`])
  expect(shot.headers.get('Cache-Control')).toBe(
    'public, max-age=31536000, immutable',
  )
  expect(shot.headers.get('Cache-Tag')).toBe(`deployment-${id}`)
})

test('F05-AC10: Given a browser that fails, When a page is taken, Then the failure is kept for a minute only, as for a cover', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')

  const shot = await takeCoverShot(
    envWith(() => new Response('{}', { status: 500 })),
    new Request(shotUrl({ kind: 'page', deploymentId: id, page: 6 })),
  )

  expect(shot.status).toBe(503)
  expect(shot.headers.get('Cache-Control')).toBe('public, max-age=60')
})

test('F05-AC11: Given a deck stopped while the browser was open on a page, When the shot comes back, Then it is not kept as the page’s image', async () => {
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
    new Request(shotUrl({ kind: 'page', deploymentId: id, page: 6 })),
  )

  expect(shot.status).toBe(404)
  expect(shot.headers.get('Cache-Control')).toBe('no-store')
})

test.each([
  ['a page past the last one taken', (id: string) => `/p1/${id}/201`],
  ['page zero', (id: string) => `/p1/${id}/0`],
  ['a page under the cover’s revision', (id: string) => `/v1/${id}/6`],
  ['a cover under the pages’ revision', (id: string) => `/p1/${id}`],
])(
  'F05-AC9: Given an internal URL that names %s, When it is taken, Then no browser runs and nothing is kept',
  async (_case, path) => {
    const id = await seedPublic(db, 'talk', 100, 'Talk')
    let asked = 0
    const env = envWith(() => {
      asked += 1
      return image()
    })

    const shot = await takeCoverShot(
      env,
      new Request(`https://cover-shots.internal${path(id)}`),
    )

    expect(shot.status).toBe(404)
    expect(shot.headers.get('Cache-Control')).toBe('no-store')
    expect(asked).toBe(0)
  },
)

const bindingOf = (env: Env) => env.BROWSER as unknown as FakeBrowserBinding

test('F05-AC18: Given a browser that cannot be opened, When a cover is taken, Then it fails for a moment only and nothing remembers it for the deployment', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(image)
  bindingOf(env).launchFails = true

  const shot = await takeCoverShot(env, new Request(coverShotUrl(id)))

  expect(shot.status).toBe(503)
  expect(shot.headers.get('Cache-Control')).toBe('no-store')
  expect(shot.headers.get('Retry-After')).toBe('5')
  expect(bindingOf(env).opened).toBeUndefined()
})

test('F05-AC18: Given a browser that fails to close, When a cover is taken, Then the image taken is still returned and the close was tried', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(image)
  bindingOf(env).closeFails = true
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const shot = await takeCoverShot(env, new Request(coverShotUrl(id)))

  expect(shot.status).toBe(200)
  expect(await shot.text()).toBe('jpeg bytes')
  expect(bindingOf(env).closed).toBe(1)
  expect(warn).toHaveBeenCalledOnce()
  warn.mockRestore()
})

test('F05-AC18: Given a browser that fails to close after a failed shot, When a cover is taken, Then the failure is the shot’s own, kept for a minute', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(() => new Response('{}', { status: 500 }))
  bindingOf(env).closeFails = true
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const shot = await takeCoverShot(env, new Request(coverShotUrl(id)))

  expect(shot.status).toBe(503)
  expect(shot.headers.get('Cache-Control')).toBe('public, max-age=60')
  expect(bindingOf(env).closed).toBe(1)
  warn.mockRestore()
})

test('F05-AC18: Given a deck the browser never answers for, When a cover is taken, Then the shot is given up at the deadline, the browser is closed and the failure is the deployment’s', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(() => new Promise<Response>(() => {}))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const pending = takeCoverShot(env, new Request(coverShotUrl(id)))
    await vi.advanceTimersByTimeAsync(SHOT_DEADLINE_MS)
    const shot = await pending

    expect(shot.status).toBe(503)
    expect(shot.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(bindingOf(env).closed).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('F05-AC18: Given a deck that opens a dialog, When it is taken, Then the dialog is dismissed', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  const env = envWith(image)

  await takeCoverShot(env, new Request(coverShotUrl(id)))

  let dismissed = 0
  bindingOf(env).seen?.onDialog?.({
    dismiss: async () => {
      dismissed += 1
    },
  })
  expect(dismissed).toBe(1)
})
