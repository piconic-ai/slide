/**
 * Reading Luma calendars' feeds into their communities: through the one
 * gate (D-63), by the one client (D-67), recording each read (D-62, D-64,
 * D-65). Nothing of a feed but its events' keys is kept (D-60).
 */
import { addFeedEvents } from '../communities/store'
import type { FeedAnswer } from './feed-answer'
import { feedModeOf } from './feed-mode'
import { isCalendar, lumaEventKeys } from './ical'
import { lumaTransport, readLumaFeed, type FeedTransport } from './luma-client'
import { mockTransport } from './mock-routes'
import { claimedRecord, recordAfter } from './schedule'
import {
  claimFeed,
  listDueFeeds,
  readFeedRecord,
  releaseGate,
  takeGate,
  writeFeedRecord,
  type DueFeed,
} from './store'

/** What a reader works with; the clock is in milliseconds. */
export type FeedReader = Readonly<{
  database: D1Database
  transport: FeedTransport
  clock: () => number
  sleep: (ms: number) => Promise<void>
}>

/** What one run of the reader did, for the log. Nothing of the feeds. */
export type ReadSummary = {
  read: number
  unchanged: number
  failed: number
  skipped: number
}

const seconds = (ms: number) => Math.floor(ms / 1000)

/** A full answer that is not a calendar is a failure. */
const checked = (answer: FeedAnswer): FeedAnswer =>
  answer.kind === 'full' && !isCalendar(answer.body)
    ? { kind: 'failed', reason: 'not_calendar', retryAfter: null }
    : answer

/** Reads one feed, holding the gate; null when another reader took it first. */
async function readOne(
  reader: FeedReader,
  feed: DueFeed,
): Promise<FeedAnswer['kind'] | null> {
  const { database } = reader
  const record = await readFeedRecord(database, feed.url)
  const startedAt = seconds(reader.clock())
  if (!(await claimFeed(database, feed.url, startedAt))) return null
  const claimed = claimedRecord(record, startedAt)
  const answer = checked(
    await readLumaFeed(feed.url, claimed.validators, reader.transport),
  )
  const now = seconds(reader.clock())
  if (answer.kind === 'full')
    await addFeedEvents(database, {
      linkId: feed.linkId,
      keys: lumaEventKeys(answer.body),
      now,
    })
  await writeFeedRecord(database, recordAfter(claimed, answer, now))
  return answer.kind
}

/**
 * Reads the feeds that are due, one at a time, the longest due first, at
 * most `limit`. Waits for the gate at most `maxWaitMs` at a time; a feed
 * left unread stays due for the next run.
 */
export async function readDueFeeds(
  reader: FeedReader,
  options: Readonly<{ limit: number; maxWaitMs: number }>,
): Promise<ReadSummary> {
  const summary: ReadSummary = { read: 0, unchanged: 0, failed: 0, skipped: 0 }
  // Another reader may keep taking the gate; waiting is bounded too.
  for (let turn = 0, waits = 0; turn < options.limit;) {
    const [feed] = await listDueFeeds(
      reader.database,
      seconds(reader.clock()),
      1,
    )
    if (!feed) break
    const gate = await takeGate(reader.database, reader.clock())
    if (gate.kind === 'busy') {
      const wait = gate.until - reader.clock()
      if (wait > options.maxWaitMs || waits >= 2 * options.limit) break
      waits += 1
      await reader.sleep(Math.max(0, wait))
      continue
    }
    turn += 1
    let kind: FeedAnswer['kind'] | null
    try {
      kind = await readOne(reader, feed)
    } finally {
      await releaseGate(reader.database, gate.lease)
    }
    if (kind === null) summary.skipped += 1
    else if (kind === 'full') summary.read += 1
    else if (kind === 'not_modified') summary.unchanged += 1
    else summary.failed += 1
  }
  return summary
}

/** Where the requests go under these settings; null when nowhere. */
export function feedTransportOf(env: Env): FeedTransport | null {
  const mode = feedModeOf({
    mock: env.LUMA_FEED_MOCK,
    publicOrigin: env.PUBLIC_ORIGIN,
  })
  return mode === 'luma'
    ? lumaTransport
    : mode === 'mock'
      ? mockTransport
      : null
}
