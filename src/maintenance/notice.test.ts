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
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'
import { noticeCache } from './notice-middleware'
import { clearNotice, readNotice, saveNotice } from './notice-store'

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env
const db = platform.env.DB
beforeAll(() => applyMigrations(db))
afterAll(() => platform.dispose())

const NOW = new Date('2026-11-26T03:00:00Z') // 12:00 in Japan
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})
beforeEach(async () => {
  vi.setSystemTime(NOW)
  await clearNotice(db)
  noticeCache.forget()
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => vi.useRealTimers())

const page = (path: string, target: Env = env, headers: HeadersInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), target)

/** A form posted to the operator host as an operator who passed Access. */
const post = async (
  path: string,
  form: Record<string, string>,
  target: Env = env,
) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        [ACCESS_TOKEN_HEADER]: await team.sign(),
        Origin: OPERATOR_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form),
    }),
    target,
  )
const operations = async (query = '') =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}/operations${query}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )

/** A plan for 1 Dec, 12:00 to 15:00 in Japan, as the form sends it. */
const PLAN = {
  starts_at: '2026-12-01T12:00',
  ends_at: '2026-12-01T15:00',
  reason: 'database',
}

const BAND = 'class="maintenance-band"'

test('F38-AC1 F38-AC6: Given a plan, When it is saved and another is saved, Then one row is kept, the later one', async () => {
  await saveNotice(db, { startsAt: 10, endsAt: 20, reason: 'update' }, 1)
  await saveNotice(db, { startsAt: 30, endsAt: 40, reason: 'other' }, 2)
  expect(await readNotice(db)).toEqual({
    startsAt: 30,
    endsAt: 40,
    reason: 'other',
  })
  const rows = await db.prepare('SELECT id FROM maintenance_notice').all()
  expect(rows.results).toEqual([{ id: 1 }])
})

test('F38-AC5: Given a plan, When it is cleared, Then none is read, and clearing again says there was none', async () => {
  await saveNotice(db, { startsAt: 10, endsAt: 20, reason: 'update' }, 1)
  expect(await clearNotice(db)).toBe(true)
  expect(await readNotice(db)).toBeNull()
  expect(await clearNotice(db)).toBe(false)
})

test('F38-AC6: Given the table, When a second row or an end before the start is written, Then the database refuses', async () => {
  await expect(
    db
      .prepare("INSERT INTO maintenance_notice VALUES (2, 1, 2, 'update', 0)")
      .run(),
  ).rejects.toThrow()
  await expect(
    db
      .prepare("INSERT INTO maintenance_notice VALUES (1, 5, 5, 'update', 0)")
      .run(),
  ).rejects.toThrow()
  await expect(
    db
      .prepare("INSERT INTO maintenance_notice VALUES (1, 1, 2, 'because', 0)")
      .run(),
  ).rejects.toThrow()
})

test('F38-AC1 F38-AC2 F38-AC8: Given the operator puts a plan in, When the operations page and the pages of the service are opened, Then the frame shows it and a band is over the header of each page', async () => {
  const sent = await post('/operations/maintenance', PLAN)
  expect(sent.status).toBe(303)
  expect(sent.headers.get('Location')).toBe(
    '/operations?maintenance=saved#maintenance',
  )
  const frame = await (await operations('?maintenance=saved')).text()
  expect(frame).toContain('<h2>メンテナンスの予定</h2>')
  expect(frame).toContain('予告を出しました。')
  expect(frame).toContain('2026年12月1日 12:00')
  expect(frame).toContain('2026年12月1日 15:00')
  expect(frame).toContain('データベースの保守')
  expect(frame).toContain('全ページの上に帯が出ています。')
  for (const label of [
    '予告を出す',
    '予告を消す',
    '開始の見込み',
    '終了の見込み',
    '理由の区分',
  ])
    expect(frame).toContain(label)
  expect(frame).toContain('deploy.md#メンテナンス作業-n')

  for (const path of [
    '/terms',
    '/privacy',
    '/help',
    '/help/bot',
    '/contact',
    '/no-such-page',
  ]) {
    const text = await (await page(path)).text()
    expect(text, path).toContain(BAND)
    // Over the header, before it.
    expect(text.indexOf(BAND), path).toBeLessThan(
      text.indexOf('<header class="site-header">'),
    )
    expect(text, path).toContain('role="status"')
    expect(text, path).toContain('2026年12月1日 12:00')
  }
})

test('F38-AC1: Given a plan, When the top page is opened, Then the band is over its header too, and a browser that holds a copy is not told 304', async () => {
  const before = await page('/')
  expect(before.status).toBe(200)
  const etag = before.headers.get('ETag')
  expect(etag).toBeTruthy()
  // Without the band it is the 304 a browser expects.
  const revalidated = await page('/', env, { 'If-None-Match': etag! })
  expect(revalidated.status).toBe(304)
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  noticeCache.forget()
  const headers: Record<string, string> = etag ? { 'If-None-Match': etag } : {}
  const after = await page('/', env, headers)
  expect(after.status).toBe(200)
  const text = await after.text()
  expect(text).toContain(BAND)
  expect(text.indexOf(BAND)).toBeLessThan(
    text.indexOf('<header class="site-header">'),
  )
  expect(after.headers.get('ETag')).toBeNull()
})

test('F38-AC1: Given a plan, When the top page is opened by a member and in English, Then the band is there as well, in English', async () => {
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  const english = await page('/?lang=en')
  expect(english.status).toBe(200)
  const text = await english.text()
  expect(text).toContain('We will stop the service for maintenance from')
  const member = await page('/', env, { Cookie: '__Host-slide_owner=unknown' })
  expect(await member.text()).toContain(BAND)
})

test('F38-AC1: Given a plan, When a page that is not HTML or an answer that is a 503 or a redirect is made, Then it is left alone', async () => {
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  const robots = await page('/robots.txt')
  expect(await robots.text()).not.toContain(BAND)
  const api = await page('/api/no-such-thing')
  expect(await api.text()).not.toContain(BAND)
  const held = await page('/my/slides', {
    ...env,
    MAINTENANCE: 'on',
    DB: undefined,
  } as unknown as Env)
  expect(held.status).toBe(503)
  expect(await held.text()).not.toContain(BAND)
})

test('F38-AC4: Given a plan whose end passes, When pages are opened before and after the end, Then the band is there and then it is not', async () => {
  await saveNotice(
    db,
    {
      startsAt: Date.UTC(2026, 10, 26, 3, 5) / 1000,
      endsAt: Date.UTC(2026, 10, 26, 4, 0) / 1000,
      reason: 'update',
    },
    1,
  )
  expect(await (await page('/terms')).text()).toContain(BAND)
  // The band's memory lasts at most a minute; after the end it does not matter.
  vi.setSystemTime(new Date('2026-11-26T04:00:00Z'))
  expect(await (await page('/terms')).text()).not.toContain(BAND)
  vi.setSystemTime(new Date('2026-11-26T03:59:59Z'))
  noticeCache.forget()
  expect(await (await page('/terms')).text()).toContain(BAND)
})

test('F38-AC5: Given a plan out, When the operator clears it, Then no band is over any page', async () => {
  await post('/operations/maintenance', PLAN)
  expect(await (await page('/terms')).text()).toContain(BAND)
  const cleared = await post('/operations/maintenance/clear', {})
  expect(cleared.status).toBe(303)
  expect(cleared.headers.get('Location')).toBe(
    '/operations?maintenance=cleared#maintenance',
  )
  expect(await readNotice(db)).toBeNull()
  expect(await (await page('/terms')).text()).not.toContain(BAND)
  const again = await post('/operations/maintenance/clear', {})
  expect(again.headers.get('Location')).toBe(
    '/operations?maintenance=nothing_to_clear#maintenance',
  )
  const frame = await (await operations('?maintenance=cleared')).text()
  expect(frame).toContain('出している予告はありません。')
  expect(frame).toContain('予告を消しました。')
})

test('F38-AC6: Given a plan out, When a new one is put in, Then the band tells the new one only', async () => {
  await post('/operations/maintenance', PLAN)
  await post('/operations/maintenance', {
    starts_at: '2026-12-05T01:00',
    ends_at: '2026-12-05T02:00',
    reason: 'update',
  })
  const text = await (await page('/terms')).text()
  expect(text).toContain('2026年12月5日 01:00')
  expect(text).not.toContain('2026年12月1日 12:00')
  expect(text.match(/class="maintenance-band"/g)).toHaveLength(1)
})

test('F38-AC7: Given a plan that starts in two days, When it is put in, Then it is stored and the frame warns', async () => {
  const sent = await post('/operations/maintenance', {
    starts_at: '2026-11-28T12:00',
    ends_at: '2026-11-28T15:00',
    reason: 'update',
  })
  expect(sent.headers.get('Location')).toBe(
    '/operations?maintenance=saved_soon#maintenance',
  )
  expect(await readNotice(db)).not.toBeNull()
  const frame = await (await operations('?maintenance=saved_soon')).text()
  expect(frame).toContain('開始まで 3 日を切っています')
  expect(frame).toContain('notice-warning')
})

test.each([
  ['the start is not a time', { starts_at: 'soon' }, '開始の見込みを'],
  ['the end is not a time', { ends_at: '' }, '終了の見込みを、日本時間'],
  [
    'the reason is none of three',
    { reason: 'fun' },
    '理由の区分を選んでください',
  ],
  [
    'the end is before the start',
    { ends_at: '2026-12-01T11:00' },
    '開始の見込みより後',
  ],
  [
    'the end has passed',
    { starts_at: '2026-11-01T00:00', ends_at: '2026-11-02T00:00' },
    'いまより後',
  ],
])(
  'F38-AC1: Given %s, When it is sent, Then nothing is stored and the page comes back with what was typed and what to fix',
  async (_, over, message) => {
    const sent = await post('/operations/maintenance', { ...PLAN, ...over })
    expect(sent.status).toBe(400)
    const body = await sent.text()
    expect(body).toContain(message)
    expect(body).toContain('role="alert"')
    // The values typed are kept.
    const typed = { ...PLAN, ...over }
    expect(body).toContain(`value="${typed.starts_at}"`)
    expect(await readNotice(db)).toBeNull()
  },
)

test('F38-AC1: Given a value with markup, When it is sent, Then it is shown escaped and nothing is stored', async () => {
  const sent = await post('/operations/maintenance', {
    ...PLAN,
    starts_at: '"><script>alert(1)</script>',
  })
  expect(sent.status).toBe(400)
  const body = await sent.text()
  expect(body).not.toContain('<script>alert(1)</script>')
  expect(await readNotice(db)).toBeNull()
})

test('F38-AC8: Given no plan, When the operations page is opened, Then the frame says none is out and still has the form and both buttons', async () => {
  const frame = await (await operations()).text()
  expect(frame).toContain('出している予告はありません。')
  expect(frame).toContain('予告を出す')
  expect(frame).toContain('予告を消す')
})

test('F38-AC8: Given a plan whose end has passed, When the operations page is opened, Then the frame says that no band is out', async () => {
  await saveNotice(
    db,
    {
      startsAt: Date.UTC(2026, 10, 25) / 1000,
      endsAt: Date.UTC(2026, 10, 26, 2, 0) / 1000,
      reason: 'other',
    },
    1,
  )
  const frame = await (await operations()).text()
  expect(frame).toContain('帯は出ていません。')
})

test('F17-AC12: Given the forms of the frame, When they are posted without the operator host origin or without Access, Then nothing changes', async () => {
  const noOrigin = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/operations/maintenance`, {
      method: 'POST',
      headers: {
        [ACCESS_TOKEN_HEADER]: await team.sign(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(PLAN),
    }),
    env,
  )
  expect(noOrigin.status).toBe(403)
  const noToken = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/operations/maintenance`, {
      method: 'POST',
      headers: {
        Origin: OPERATOR_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(PLAN),
    }),
    env,
  )
  expect(noToken.status).toBe(404)
  const onManagementHost = await server.fetch(
    new Request(`${TEST_ORIGIN}/operations/maintenance`, {
      method: 'POST',
      body: new URLSearchParams(PLAN),
    }),
    env,
  )
  expect(onManagementHost.status).not.toBe(303)
  expect(await readNotice(db)).toBeNull()
})

/** A D1 that counts how many statements are prepared on it. */
function counting(real: D1Database) {
  const count = { prepared: 0 }
  const proxy = new Proxy(real, {
    get(target, key, receiver) {
      if (key === 'prepare' || key === 'batch' || key === 'exec')
        count.prepared += 1
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { count, proxy }
}

test('F38-AC1 (reads): Given a plan, When 200 requests arrive within a minute, Then D1 is read once, and again only after the minute', async () => {
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  noticeCache.forget()
  const { count, proxy } = counting(db)
  const target = { ...env, DB: proxy } as unknown as Env
  for (let i = 0; i < 200; i++) await page('/terms', target)
  expect(count.prepared).toBe(1)
  vi.setSystemTime(new Date(NOW.getTime() + 59_000))
  await page('/terms', target)
  expect(count.prepared).toBe(1)
  vi.setSystemTime(new Date(NOW.getTime() + 61_000))
  await page('/terms', target)
  expect(count.prepared).toBe(2)
})

test('F38-AC1 (reads): Given requests that arrive together, When the memory is empty, Then they share one read', async () => {
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  noticeCache.forget()
  const { count, proxy } = counting(db)
  const target = { ...env, DB: proxy } as unknown as Env
  await Promise.all(Array.from({ length: 30 }, () => page('/terms', target)))
  expect(count.prepared).toBe(1)
})

test('F38-AC1 (reads): Given no plan, When 100 requests arrive, Then D1 is still read once in the minute', async () => {
  const { count, proxy } = counting(db)
  const target = { ...env, DB: proxy } as unknown as Env
  for (let i = 0; i < 100; i++) await page('/terms', target)
  expect(count.prepared).toBe(1)
})

test('F38-AC1 (reads): Given a D1 that cannot be read, When pages are opened, Then they open with no band, the failure is logged without a detail, and D1 is asked again only after a short while', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  let asked = 0
  const broken = new Proxy(
    {},
    {
      get() {
        asked += 1
        throw new Error('D1 is down: secret detail')
      },
    },
  )
  const target = { ...env, DB: broken } as unknown as Env
  for (let i = 0; i < 20; i++) {
    const response = await page('/terms', target)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain(BAND)
  }
  expect(asked).toBe(1)
  expect(JSON.stringify(log.mock.calls)).toContain(
    'maintenance_notice_unreadable',
  )
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail')
  vi.setSystemTime(new Date(NOW.getTime() + 16_000))
  await page('/terms', target)
  expect(asked).toBe(2)
})

test('F38-AC1: Given the band is not wanted while the service is held, When maintenance is on, Then D1 is not asked for the plan at all', async () => {
  await saveNotice(
    db,
    { startsAt: 1, endsAt: 2_000_000_000, reason: 'update' },
    1,
  )
  noticeCache.forget()
  const { count, proxy } = counting(db)
  const held = { ...env, DB: proxy, MAINTENANCE: 'on' } as unknown as Env
  for (const path of ['/terms', '/help', '/my/slides'])
    expect(await (await page(path, held)).text()).not.toContain(BAND)
  expect(count.prepared).toBe(0)
})

test('F38-AC1 (reads): Given a read of D1 that does not answer, When a page is opened, Then it opens within the time given, with no band, and the failure is kept for a short while', async () => {
  const { createNoticeCache } = await import('./notice-middleware')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  let asked = 0
  let clock = 1000
  const cache = createNoticeCache(
    () => {
      asked += 1
      return new Promise(() => {})
    },
    () => clock,
    20,
  )
  const started = performance.now()
  expect(await cache.get(env)).toBeNull()
  expect(performance.now() - started).toBeLessThan(500)
  expect(await cache.get(env)).toBeNull()
  expect(asked).toBe(1)
  expect(JSON.stringify(log.mock.calls)).toContain('TimeoutError')
  clock += 16
  await cache.get(env)
  expect(asked).toBe(2)
})

test('F38-AC1 (reads): Given a read that answers in time, When it is awaited, Then the answer is kept and no failure is logged', async () => {
  const { createNoticeCache } = await import('./notice-middleware')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const plan = { startsAt: 1, endsAt: 2, reason: 'update' } as const
  let asked = 0
  const cache = createNoticeCache(
    async () => {
      asked += 1
      return plan
    },
    () => 0,
    50,
  )
  expect(await cache.get(env)).toEqual(plan)
  expect(await cache.get(env)).toEqual(plan)
  expect(asked).toBe(1)
  expect(log).not.toHaveBeenCalled()
})

test('F38-AC1 (reads): Given a plan saved while an older read is still on its way, When the older read ends, Then it does not put "no plan" back over the saved one', async () => {
  const { createNoticeCache } = await import('./notice-middleware')
  let release: (value: null) => void = () => {}
  let stored: { startsAt: number; endsAt: number; reason: 'update' } | null =
    null
  let first = true
  const cache = createNoticeCache(
    () => {
      if (first) {
        first = false
        return new Promise((resolve) => (release = resolve))
      }
      return Promise.resolve(stored)
    },
    () => 0,
    10_000,
  )
  const old = cache.get(env)
  // The operator saves, and this isolate forgets, while the first read runs.
  stored = { startsAt: 1, endsAt: 2, reason: 'update' }
  cache.forget()
  release(null)
  // The one that was waiting is answered with what its read found...
  expect(await old).toBeNull()
  // ...but the next request reads again and finds the saved plan.
  expect(await cache.get(env)).toEqual(stored)
})

test('F38-AC1 (reads): Given a forget while a read is on its way, When requests come after it, Then they do not share the older read', async () => {
  const { createNoticeCache } = await import('./notice-middleware')
  let asked = 0
  const releases: ((v: null) => void)[] = []
  const cache = createNoticeCache(
    () => {
      asked += 1
      return new Promise((resolve) => releases.push(resolve))
    },
    () => 0,
    10_000,
  )
  const a = cache.get(env)
  cache.forget()
  const b = cache.get(env)
  expect(asked).toBe(2)
  releases.forEach((r) => r(null))
  await Promise.all([a, b])
  // The older read ending does not clear the newer one's place: it is kept.
  await cache.get(env)
  expect(asked).toBe(2)
})
