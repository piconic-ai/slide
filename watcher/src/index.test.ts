import { afterEach, expect, test, vi } from 'vitest'
import watcher from './index'
import { WatchState } from './watch-state'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`
const WATCH_URLS = {
  top: 'https://slide.example/',
  viewer: 'https://slide.example/@h/s',
  content: 'https://d-x.content.example/',
}
afterEach(() => vi.unstubAllGlobals())

/** A watcher environment whose Durable Object is a real WatchState over a Map. */
function environment(extra: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>()
  const object = new WatchState({
    storage: {
      get: async (key: string) => data.get(key),
      put: async (key: string, value: unknown) => void data.set(key, value),
    },
  } as unknown as DurableObjectState)
  return {
    STATE: {
      idFromName: () => 'id',
      get: () => ({
        fetch: (url: string, init: RequestInit) =>
          object.fetch(new Request(url, init)),
      }),
    },
    DISCORD_WEBHOOK_URL: WEBHOOK,
    WATCH_URLS,
    ...extra,
  } as unknown as Parameters<NonNullable<typeof watcher.scheduled>>[1]
}

async function fire(env: ReturnType<typeof environment>, at: number) {
  const waited: Promise<unknown>[] = []
  await watcher.scheduled!(
    { scheduledTime: at * 1000, cron: '*/5 * * * *', noRetry() {} },
    env,
    {
      waitUntil: (p: Promise<unknown>) => waited.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  )
  await Promise.all(waited)
}

/** Stands in for the network: the service's addresses, and Discord. */
function network(serviceStatus: () => number) {
  const discord: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('https://discord.com/')) {
        discord.push(init)
        return new Response(null, { status: 204 })
      }
      return new Response('x', { status: serviceStatus() })
    }),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return discord
}

test('F39-AC13: Given a service that fails once, When two firings are made, Then Discord hears nothing', async () => {
  let status = 500
  const discord = network(() => status)
  const env = environment()
  await fire(env, 1000)
  status = 200
  await fire(env, 1300)
  expect(discord).toHaveLength(0)
})

test('F39-AC14 and F39-AC15: Given a service that fails twice and then answers, When firings are made, Then Discord hears "down" once per address and then "open again" once', async () => {
  let status = 500
  const discord = network(() => status)
  const env = environment()
  await fire(env, 1000)
  await fire(env, 1300)
  await fire(env, 1600)
  expect(discord).toHaveLength(3)
  status = 200
  await fire(env, 1900)
  await fire(env, 2200)
  expect(discord).toHaveLength(6)
  const bodies = discord.map(
    (init) => JSON.parse(String(init.body)).content as string,
  )
  expect(bodies.filter((b) => b.includes('ページが開けません'))).toHaveLength(3)
  expect(
    bodies.filter((b) => b.includes('ページが開けるようになりました')),
  ).toHaveLength(3)
  for (const init of discord) {
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({
      parse: [],
    })
    expect(init.redirect).toBe('manual')
  }
})

test('F39-AC10: Given a failing service and no webhook, When firings are made, Then nothing is posted, and once the webhook is set the notice goes out', async () => {
  let status = 500
  const discord = network(() => status)
  const env = environment({ DISCORD_WEBHOOK_URL: undefined })
  await fire(env, 1000)
  await fire(env, 1300)
  expect(discord).toHaveLength(0)
  const withWebhook = { ...env, DISCORD_WEBHOOK_URL: WEBHOOK } as typeof env
  await fire(withWebhook, 1600)
  expect(discord).toHaveLength(3)
  status = 200
})

test('F39-AC12: Given a state that answers an error, When a firing is made, Then it is logged and does not throw', async () => {
  network(() => 200)
  const broken = environment()
  ;(broken as unknown as { STATE: { get: () => unknown } }).STATE.get = () => ({
    fetch: async () => new Response(null, { status: 500 }),
  })
  await expect(fire(broken, 1000)).resolves.toBeUndefined()
})

test('F39-AC14: Given Discord that cannot be reached, When "down" is to be told, Then the run does not throw and the notice is tried at the next firing', async () => {
  let reachable = false
  const discord: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('https://discord.com/')) {
        if (!reachable) throw new TypeError('network')
        discord.push(init)
        return new Response(null, { status: 204 })
      }
      return new Response('x', { status: 500 })
    }),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const env = environment()
  await fire(env, 1000)
  await fire(env, 1300)
  expect(discord).toHaveLength(0)
  reachable = true
  await fire(env, 1600)
  expect(discord).toHaveLength(3)
})

/** The network with an answer for the service that carries headers too. */
function networkWith(
  serviceAnswer: () => { status: number; headers?: Record<string, string> },
) {
  const discord: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('https://discord.com/')) {
        discord.push(init)
        return new Response(null, { status: 204 })
      }
      const { status, headers } = serviceAnswer()
      return new Response('x', { status, headers })
    }),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return discord
}

const contentOf = (discord: RequestInit[]) =>
  discord.map((init) => JSON.parse(String(init.body)).content as string)

const END = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000
const HELD = {
  status: 503,
  headers: { 'X-Slide-Maintenance': 'on;until=2026-12-01T03:00:00Z' },
}

test('F38-AC24 F38-AC25 F38-AC26: Given a service held for maintenance past its end and then open, When firings are made every five minutes, Then Discord hears of the start, the overrun and the end once each, and never that a page cannot be opened', async () => {
  let answer: { status: number; headers?: Record<string, string> } = {
    status: 200,
  }
  const discord = networkWith(() => answer)
  const env = environment()
  await fire(env, END - 3600)
  answer = HELD
  for (let at = END - 3300; at <= END + 3600; at += 300) await fire(env, at)
  answer = { status: 200 }
  await fire(env, END + 3900)
  await fire(env, END + 4200)
  const bodies = contentOf(discord)
  expect(bodies).toHaveLength(3)
  expect(bodies[0]).toContain('メンテナンスが始まりました')
  expect(bodies[0]).toContain('2026-12-01 12:00 JST(03:00 UTC)')
  expect(bodies[1]).toContain('メンテナンスが終わる見込みを過ぎています')
  expect(bodies[2]).toContain('メンテナンスが終わりました')
  expect(bodies.some((b) => b.includes('ページが開けません'))).toBe(false)
  expect(bodies.some((b) => b.includes('開けるようになりました'))).toBe(false)
})

test('F38-AC24: Given the same 503 with no mark of maintenance, When firings are made, Then it is a failure and Discord hears of it', async () => {
  const discord = networkWith(() => ({ status: 503 }))
  const env = environment()
  await fire(env, 1000)
  await fire(env, 1300)
  expect(
    contentOf(discord).filter((b) => b.includes('ページが開けません')),
  ).toHaveLength(3)
  expect(contentOf(discord).some((b) => b.includes('メンテナンス'))).toBe(false)
})

test('F38-AC25: Given Discord that cannot be reached when maintenance starts, When firings go on, Then the start is told when it can be', async () => {
  let reachable = false
  const discord: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('https://discord.com/')) {
        if (!reachable) throw new TypeError('network')
        discord.push(init)
        return new Response(null, { status: 204 })
      }
      return new Response('x', HELD)
    }),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const env = environment()
  await fire(env, 1000)
  await fire(env, 1300)
  expect(discord).toHaveLength(0)
  reachable = true
  await fire(env, 1600)
  await fire(env, 1900)
  expect(contentOf(discord)).toHaveLength(1)
  expect(contentOf(discord)[0]).toContain('メンテナンスが始まりました')
})

test('F38-AC25: Given no webhook while maintenance starts and ends, When the webhook is set after, Then the start is told once it is set, and the end after it', async () => {
  let answer: { status: number; headers?: Record<string, string> } = HELD
  const discord = networkWith(() => answer)
  const env = environment({ DISCORD_WEBHOOK_URL: undefined })
  await fire(env, 1000)
  const withWebhook = { ...env, DISCORD_WEBHOOK_URL: WEBHOOK } as typeof env
  await fire(withWebhook, 1300)
  answer = { status: 200 }
  await fire(withWebhook, 1600)
  expect(contentOf(discord).map((b) => b.split('\n')[0])).toEqual([
    '[slide 見張り] メンテナンスが始まりました',
    '[slide 見張り] メンテナンスが終わりました',
  ])
})
