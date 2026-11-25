import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { listCommunityEventIds } from '../communities/store'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
import { seedDeck, seedPerson } from '../publication/test-support'
import { readFeedRecord } from './store'
import { resetFeeds } from './test-feeds'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const FEED = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-kpm'

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetFeeds(database)
  await seedPerson(database, '722500', 'owner')
  await seedDeck(database, 'talk')
  await seedTalkLink(database, {
    deckId: 'talk',
    url: 'https://lu.ma/slide-mock-one',
  })
  await seedCommunity(database, { id: 7, handle: 'kpm', links: [FEED] })
})
afterAll(() => platform.dispose())

async function fire(env: Env) {
  const waited: Promise<unknown>[] = []
  await server.scheduled(
    { scheduledTime: Date.now(), cron: '17 * * * *', noRetry() {} },
    env,
    {
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  )
  await Promise.allSettled(waited)
}

test('F33-AC14: Given a calendar never read, When the hourly Cron Trigger fires on a local start, Then its feed is read and due again a day later', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const local = {
      ...platform.env,
      PUBLIC_ORIGIN: 'http://localhost:8770',
      CONTENT_ORIGIN: 'http://localhost:8770',
      LUMA_FEED_MOCK: 'on',
    } as unknown as Env
    await fire(local)
    expect(await listCommunityEventIds(database, 7)).toHaveLength(1)
    const record = await readFeedRecord(database, FEED)
    expect(record.dueAt - (record.readAt ?? 0)).toBe(86400)
    await fire(local)
    const requests = log.mock.calls.filter(([line]) =>
      String(line).includes('luma_mock_request'),
    )
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(log.mock.calls)).toContain('feeds_read')
  } finally {
    vi.restoreAllMocks()
  }
})

test('F33-AC14: Given a start that is neither the service nor local with the switch, When the Cron Trigger fires, Then nothing is asked of anyone', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await fire({
      ...platform.env,
      PUBLIC_ORIGIN: 'https://slide.example',
    } as unknown as Env)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await readFeedRecord(database, FEED)).readAt).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})
