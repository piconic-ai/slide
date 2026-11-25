/**
 * Reading Luma calendars' feeds into their communities: through the one
 * gate (D-63), by the one client (D-67), recording each read (D-62, D-64,
 * D-65). Nothing of a feed but its events' keys is kept (D-60).
 */
import { addFeedEvents } from '../communities/store'
import type { EventRef } from '../events/event-url'
import type { FeedAnswer } from './feed-answer'
import { feedModeOf } from './feed-mode'
import { isCalendar, lumaEventKeys } from './ical'
import { FEED_SPACING_MS } from './limits'
import { lumaTransport, readLumaFeed, type FeedTransport } from './luma-client'
import { mockTransport } from './mock-routes'
import { claimedRecord, recordAfter, type FeedRecord } from './schedule'
import {
  claimFeed,
  hasFeedEvents,
  listDueFeeds,
  listFeedsForUnknownEvent,
  listLumaLinksAddedSince,
  readFeedRecord,
  releaseGate,
  requestFeedReads,
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
 * Reads the feeds that are due, one at a time, those in `first` first and
 * then the longest due, at
 * most `limit`. Waits for the gate at most `maxWaitMs` at a time; a feed
 * left unread stays due for the next run.
 */
export async function readDueFeeds(
  reader: FeedReader,
  options: Readonly<{
    limit: number
    maxWaitMs: number
    /** Feeds to read before any other that is due: an early read's. */
    first?: readonly string[]
  }>,
): Promise<ReadSummary> {
  const summary: ReadSummary = { read: 0, unchanged: 0, failed: 0, skipped: 0 }
  // Another reader may keep taking the gate; waiting is bounded too.
  for (let turn = 0, waits = 0; turn < options.limit;) {
    const [feed] = await listDueFeeds(
      reader.database,
      seconds(reader.clock()),
      1,
      options.first,
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

const realReader = (env: Env, transport: FeedTransport): FeedReader => ({
  database: env.DB,
  transport,
  clock: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/** How many feeds one run of the hourly Cron Trigger reads at most: six minutes. */
export const FEEDS_PER_RUN = 60

/** How many feeds are read after a response, within its waitUntil. */
export const FEEDS_AFTER_RESPONSE = 3

/** The longest wait for the gate, a little more than its spacing. */
const GATE_WAIT_MS = FEED_SPACING_MS + 1_000

/**
 * The Cron Trigger's run (F33-AC14): the feeds that are due, one after the
 * other. Each is due a day after its last read, so each is read once a day.
 */
export async function readFeedsOnSchedule(env: Env): Promise<ReadSummary> {
  const transport = feedTransportOf(env)
  if (!transport) return { read: 0, unchanged: 0, failed: 0, skipped: 0 }
  return readDueFeeds(realReader(env, transport), {
    limit: FEEDS_PER_RUN,
    maxWaitMs: GATE_WAIT_MS,
  })
}

/** Something to hand work that outlives the response; null without one. */
export type WaitUntil = ((work: Promise<unknown>) => void) | null

const logged = (work: Promise<ReadSummary>) =>
  work.then(
    (summary) =>
      console.log(JSON.stringify({ event: 'feeds_read_soon', ...summary })),
    (error: unknown) =>
      console.error(
        JSON.stringify({
          event: 'feeds_read_soon_error',
          name: error instanceof Error ? error.name : 'unknown',
        }),
      ),
  )

/**
 * Asks for early reads of the feeds (D-61) and reads what is due after the
 * response. A feed read within the hour, waiting after failures or stopped
 * is left as it is (D-62, D-65); what is not read now is read by the next
 * Cron Trigger. Without `waitUntil` nothing is read now.
 */
export async function readFeedsSoon(
  env: Env,
  waitUntil: WaitUntil,
  urls: readonly string[],
): Promise<void> {
  if (urls.length === 0) return
  await requestFeedReads(env.DB, urls, Math.floor(Date.now() / 1000))
  const transport = feedTransportOf(env)
  if (!transport || !waitUntil) return
  waitUntil(
    logged(
      readDueFeeds(realReader(env, transport), {
        limit: FEEDS_AFTER_RESPONSE,
        maxWaitMs: GATE_WAIT_MS,
        first: urls,
      }),
    ),
  )
}

/**
 * After a community's links are saved (F33-AC2): the Luma calendars just
 * added are read soon. `since` is the time the save wrote as theirs.
 */
export async function readNewCalendarsSoon(
  env: Env,
  waitUntil: WaitUntil,
  communityId: number,
  since: number,
): Promise<void> {
  await readFeedsSoon(
    env,
    waitUntil,
    await listLumaLinksAddedSince(env.DB, communityId, since),
  )
}

/**
 * After a related link of a Luma event is saved (F33-AC3): when no
 * calendar's feed lists the event yet, every calendar is read soon.
 */
export async function readCalendarsForEventSoon(
  env: Env,
  waitUntil: WaitUntil,
  event: EventRef,
): Promise<void> {
  if (event.service !== 'luma') return
  await readFeedsSoon(
    env,
    waitUntil,
    await listFeedsForUnknownEvent(env.DB, event.key),
  )
}

/** The `waitUntil` of a request's context, or null where it has none (tests). */
export function waitUntilOf(
  c: Readonly<{ executionCtx: { waitUntil(work: Promise<unknown>): void } }>,
): WaitUntil {
  try {
    const context = c.executionCtx
    return (work) => context.waitUntil(work)
  } catch {
    return null
  }
}
