/**
 * Reading Luma calendars' feeds into their communities: through the one
 * gate (D-63), by the one client (D-67), recording each read (D-62, D-64,
 * D-65). Nothing of a feed but its events' keys is kept (D-60).
 */
import { addFeedEvents } from '../communities/store'
import type { FeedAnswer } from './feed-answer'
import { isCalendar, lumaEventKeys } from './ical'
import { readLumaFeed, type FeedTransport } from './luma-client'
import { claimedRecord, recordAfter, type FeedRecord } from './schedule'
import {
  claimFeed,
  hasFeedEvents,
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
  const claimed = claimedRecord(record, startedAt)
  if (
    !(await claimFeed(
      database,
      interruptedRecord(claimed, startedAt),
      startedAt,
    ))
  )
    return null
  // Without an event from this link's feed yet, a 304 would keep it empty.
  const validators = (await hasFeedEvents(database, feed.linkId))
    ? claimed.validators
    : NO_VALIDATORS
  const answer = checked(
    await readLumaFeed(feed.url, validators, reader.transport),
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

const NO_VALIDATORS = { etag: null, lastModified: null } as const

/** The record written as a read starts, standing until its outcome is. */
const interruptedRecord = (claimed: FeedRecord, now: number) =>
  recordAfter(
    claimed,
    { kind: 'failed', reason: 'interrupted', retryAfter: null },
    now,
  )

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
