import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { seedCommunity } from '../communities/test-communities'
import { lumaFeeds } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { testEnv } from '../publication/test-support'
import { isReadable } from './schedule'
import { readFeedRecord } from './store'
import { resetFeeds } from './test-feeds'

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

const FEED = 'https://api.luma.com/ics/get?entity=calendar&id=cal-kpm'
const GONE = 'https://api.luma.com/ics/get?entity=calendar&id=cal-gone'
const now = () => Math.floor(Date.now() / 1000)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetFeeds(db)
  await seedCommunity(db, { id: 7, handle: 'kpm', links: [FEED] })
  await orm.insert(lumaFeeds).values([
    {
      url: FEED,
      read_at: now() - 7200,
      not_before: now() + 86400,
      due_at: now() + 86400,
      failures: 5,
      last_failure: 'rate_limited',
      retry_until: now() + 3 * 86400,
      stopped_at: now() - 7200,
      etag: '"v1"',
    },
    {
      url: GONE,
      read_at: 1,
      failures: 5,
      last_failure: 'timeout',
      stopped_at: 2,
    },
  ])
})
afterAll(() => platform.dispose())

const home = async (path = '/') =>
  (
    await (
      await server.fetch(
        new Request(`${OPERATOR_ORIGIN}${path}`, {
          headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')

const resume = async (url: string, origin = OPERATOR_ORIGIN) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}/feeds/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
        [ACCESS_TOKEN_HEADER]: await team.sign(),
      },
      body: new URLSearchParams({ url }),
    }),
    env,
  )

test('F33-AC9: Given stopped feeds, When the operator page opens, Then they are listed after the communities with their community, reason and a resume button', async () => {
  const body = await home()
  const communities = body.indexOf('<h2>コミュニティ</h2>')
  const section = body.slice(body.indexOf('<h2>止まった配信</h2>'))
  expect(communities).toBeGreaterThan(-1)
  expect(body.indexOf('<h2>止まった配信</h2>')).toBeGreaterThan(communities)
  expect(section).toContain(`<code>${FEED.replace(/&/gu, '&amp;')}</code>`)
  expect(section).toContain('<code>@kpm</code>')
  expect(section).toContain('429(取得が多すぎる)が返りました。')
  expect(section).toContain('応答が 10 秒を超えたので打ち切りました。')
  expect(section).toContain('なし(紐づけ用リンクが外れています)')
  expect(section).toContain('5 回')
  expect(section.match(/action="\/feeds\/resume"/gu)).toHaveLength(2)
  expect(section).toContain('>再開する</button>')
})

test('F33-AC9: Given a stopped feed, When the operator resumes it, Then it is read again and its Retry-After is let go, but not before the hour', async () => {
  const response = await resume(FEED)
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/?result=feed_resumed')
  const record = await readFeedRecord(db, FEED)
  expect(record.state).toEqual({ kind: 'active', lastFailure: null })
  expect(record.failures).toBe(0)
  expect(record.retryUntil).toBeNull()
  expect(record.validators.etag).toBe('"v1"')
  expect(isReadable(record, now())).toBe(true)
  const after = await home('/?result=feed_resumed')
  expect(after).toContain('配信を再開しました。')
  expect(after.slice(after.indexOf('<h2>止まった配信</h2>'))).not.toContain(
    '<code>@kpm</code>',
  )
})

test('F33-AC9: Given a feed that is not stopped or an address that is no feed, When it is resumed, Then nothing changes', async () => {
  await resume(FEED)
  const before = await readFeedRecord(db, FEED)
  for (const url of [FEED, 'https://evil.example/', ''])
    expect((await resume(url)).headers.get('Location')).toBe(
      '/?result=feed_not_stopped',
    )
  expect(await readFeedRecord(db, FEED)).toEqual(before)
})

test('Given a request from another origin, When it resumes a feed, Then it is refused', async () => {
  expect((await resume(FEED, 'https://evil.example')).status).toBe(403)
  expect((await readFeedRecord(db, FEED)).state.kind).toBe('stopped')
})
