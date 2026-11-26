import { drizzle } from 'drizzle-orm/d1'
import { lumaEventAliases, lumaFeedGate, lumaFeeds } from '../db/schema'
import { resetCommunities } from '../communities/test-communities'
import type { FeedTransport } from './luma-client'
import type { FeedReader } from './reader-routes'

/** Clears the records of feeds and opens the gate, then the communities. */
export async function resetFeeds(db: D1Database) {
  const orm = drizzle(db)
  await orm.batch([
    orm.delete(lumaFeeds),
    orm.delete(lumaEventAliases),
    orm.update(lumaFeedGate).set({ busy_until: 0, next_start_at: 0 }),
  ])
  await resetCommunities(db)
}

/** A calendar listing the given addresses, each on its event's URL line. */
export const feedOf = (...urls: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...urls.flatMap((url, index) => [
      'BEGIN:VEVENT',
      `SUMMARY:Secret meetup ${index}`,
      'DTSTART:20261201T100000Z',
      'LOCATION:Somewhere in Yokohama',
      `URL:${url}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n')

/** One request as a fake Luma saw it, with the reader's clock. */
export type Seen = Readonly<{ at: number; request: Request }>

/**
 * A reader on a clock the test moves: sleeping moves it on. `answer` is the
 * fake Luma; what it was asked is in `seen`.
 */
export function fakeReader(
  database: D1Database,
  answer: (request: Request, at: number) => Response | Promise<Response>,
  start = 1_800_000_000_000,
) {
  const clock = { now: start }
  const seen: Seen[] = []
  const transport: FeedTransport = async (request) => {
    seen.push({ at: clock.now, request })
    return answer(request, clock.now)
  }
  const reader: FeedReader = {
    database,
    transport,
    clock: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms
    },
  }
  return { reader, clock, seen }
}
