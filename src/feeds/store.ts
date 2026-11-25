import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  communityFeedEvents,
  communityLinks,
  handles,
  lumaFeedGate,
  lumaFeeds,
} from '../db/schema'
import { handleSchema, type Handle } from '../share/handle'
import type { FeedFailure } from './feed-answer'
import { FEED_LEASE_MS, FEED_SPACING_MS, MIN_READ_INTERVAL } from './limits'
import { newFeedRecord, type FeedRecord } from './schedule'

type FeedRow = typeof lumaFeeds.$inferSelect

const recordOf = (row: FeedRow): FeedRecord => ({
  url: row.url,
  readAt: row.read_at,
  notBefore: row.not_before,
  dueAt: row.due_at,
  retryUntil: row.retry_until,
  validators: { etag: row.etag, lastModified: row.last_modified },
  failures: row.failures,
  state:
    row.stopped_at !== null && row.last_failure !== null
      ? { kind: 'stopped', at: row.stopped_at, reason: row.last_failure }
      : { kind: 'active', lastFailure: row.last_failure },
})

const rowOf = (record: FeedRecord): FeedRow => ({
  url: record.url,
  read_at: record.readAt,
  not_before: record.notBefore,
  due_at: record.dueAt,
  retry_until: record.retryUntil,
  etag: record.validators.etag,
  last_modified: record.validators.lastModified,
  failures: record.failures,
  last_failure:
    record.state.kind === 'stopped'
      ? record.state.reason
      : record.state.lastFailure,
  stopped_at: record.state.kind === 'stopped' ? record.state.at : null,
})

/** The record of a feed; a feed never read has a new one. */
export async function readFeedRecord(
  database: D1Database,
  url: string,
): Promise<FeedRecord> {
  const row = await drizzle(database)
    .select()
    .from(lumaFeeds)
    .where(eq(lumaFeeds.url, url))
    .get()
  return row ? recordOf(row) : newFeedRecord(url)
}

/** Writes a feed's record whole. */
export async function writeFeedRecord(
  database: D1Database,
  record: FeedRecord,
): Promise<void> {
  const { url, ...rest } = rowOf(record)
  await drizzle(database)
    .insert(lumaFeeds)
    .values({ url, ...rest })
    .onConflictDoUpdate({ target: lumaFeeds.url, set: rest })
}

/** A Luma calendar to read, with the community link it is held by. */
export type DueFeed = Readonly<{ linkId: number; url: string }>

const isDue = (now: number) =>
  sql`(${lumaFeeds.url} IS NULL OR (${lumaFeeds.stopped_at} IS NULL
    AND ${lumaFeeds.due_at} <= ${now} AND ${lumaFeeds.not_before} <= ${now}))`

/**
 * The Luma calendars communities hold that are to be read now, the longest
 * due first: never read, or due and past the hour and any wait, and not
 * stopped (D-61, D-62, D-65).
 */
export async function listDueFeeds(
  database: D1Database,
  now: number,
  limit: number,
): Promise<readonly DueFeed[]> {
  return drizzle(database)
    .select({ linkId: communityLinks.id, url: communityLinks.url })
    .from(communityLinks)
    .leftJoin(lumaFeeds, eq(lumaFeeds.url, communityLinks.url))
    .where(and(eq(communityLinks.kind, 'luma'), isDue(now)))
    .orderBy(sql`coalesce(${lumaFeeds.due_at}, 0)`, asc(communityLinks.id))
    .limit(limit)
    .all()
}

/**
 * Takes the feed to ask for it now, in one statement: only if it is due and
 * not asked for within the hour, so two readers never both ask (D-62).
 * Writes when it was asked for and that it is not to be asked for again
 * within the hour.
 */
export async function claimFeed(
  database: D1Database,
  url: string,
  now: number,
): Promise<boolean> {
  const result = await database
    .prepare(
      `INSERT INTO luma_feeds (url, read_at, not_before) VALUES (?1, ?2, ?3)
      ON CONFLICT (url) DO UPDATE SET read_at = ?2, not_before = ?3
      WHERE stopped_at IS NULL AND due_at <= ?2 AND not_before <= ?2`,
    )
    .bind(url, now, now + MIN_READ_INTERVAL)
    .run()
  return result.meta.changes === 1
}

/** The gate of requests to Luma, as one reader holds it. */
export type GateTake =
  | Readonly<{ kind: 'taken'; lease: number }>
  | Readonly<{ kind: 'busy'; until: number }>

/**
 * Takes the one gate every request to Luma passes (D-63), in one
 * statement: only when no request holds it and six seconds have passed
 * since the last one started. In milliseconds. `lease` releases it.
 */
export async function takeGate(
  database: D1Database,
  now: number,
): Promise<GateTake> {
  const lease = now + FEED_LEASE_MS
  const taken = await database
    .prepare(
      `UPDATE luma_feed_gate SET busy_until = ?2, next_start_at = ?3
      WHERE id = 1 AND busy_until <= ?1 AND next_start_at <= ?1`,
    )
    .bind(now, lease, now + FEED_SPACING_MS)
    .run()
  if (taken.meta.changes === 1) return { kind: 'taken', lease }
  const gate = await drizzle(database)
    .select()
    .from(lumaFeedGate)
    .where(eq(lumaFeedGate.id, 1))
    .get()
  return {
    kind: 'busy',
    until: Math.max(gate?.busy_until ?? now, gate?.next_start_at ?? now),
  }
}

/** Lets the gate go, unless its lease ran out and another took it. */
export async function releaseGate(
  database: D1Database,
  lease: number,
): Promise<void> {
  await drizzle(database)
    .update(lumaFeedGate)
    .set({ busy_until: 0 })
    .where(and(eq(lumaFeedGate.id, 1), eq(lumaFeedGate.busy_until, lease)))
}

/**
 * Asks for an early read of the feeds (D-61): each is due now. The hour
 * since the last request, a wait after failures and a stop are kept, so no
 * number of requests reads a feed sooner (D-62).
 */
export async function requestFeedReads(
  database: D1Database,
  urls: readonly string[],
  now: number,
): Promise<void> {
  const unique = [...new Set(urls)]
  if (unique.length === 0) return
  await database.batch(
    unique.map((url) =>
      database
        .prepare(
          `INSERT INTO luma_feeds (url, due_at) VALUES (?1, ?2)
          ON CONFLICT (url) DO UPDATE SET due_at = min(due_at, ?2)`,
        )
        .bind(url, now),
    ) as [D1PreparedStatement, ...D1PreparedStatement[]],
  )
}

/**
 * The Luma calendars a community took on at or after `since`: those just
 * added, as a link kept from before keeps when it was added (F33-AC2).
 */
export async function listLumaLinksAddedSince(
  database: D1Database,
  communityId: number,
  since: number,
): Promise<readonly string[]> {
  const rows = await drizzle(database)
    .select({ url: communityLinks.url })
    .from(communityLinks)
    .where(
      and(
        eq(communityLinks.community_id, communityId),
        eq(communityLinks.kind, 'luma'),
        sql`${communityLinks.created_at} >= ${since}`,
      ),
    )
    .all()
  return rows.map((row) => row.url)
}

/**
 * The Luma calendars to read early for an event's key (F33-AC3): every
 * calendar a community holds that is not stopped, when no calendar's feed
 * lists the key yet; none when one does.
 */
export async function listFeedsForUnknownEvent(
  database: D1Database,
  eventKey: string,
): Promise<readonly string[]> {
  const db = drizzle(database)
  const known = await db
    .select({ key: communityFeedEvents.event_key })
    .from(communityFeedEvents)
    .where(eq(communityFeedEvents.event_key, eventKey))
    .limit(1)
    .get()
  if (known) return []
  const rows = await db
    .select({ url: communityLinks.url })
    .from(communityLinks)
    .leftJoin(lumaFeeds, eq(lumaFeeds.url, communityLinks.url))
    .where(
      and(
        eq(communityLinks.kind, 'luma'),
        sql`${lumaFeeds.stopped_at} IS NULL`,
      ),
    )
    .orderBy(asc(communityLinks.id))
    .all()
  return rows.map((row) => row.url)
}

/** A stopped feed, as the operator's page lists it. */
export type StoppedFeed = Readonly<{
  url: string
  /** The community that holds it; null once no community does. */
  community: Handle | null
  stoppedAt: number
  reason: FeedFailure
  failures: number
}>

/** How many stopped feeds the operator's page lists, the latest first. */
export const STOPPED_FEEDS = 100

/** The stopped feeds (D-65), the latest stopped first. */
export async function listStoppedFeeds(
  database: D1Database,
): Promise<readonly StoppedFeed[]> {
  const rows = await drizzle(database)
    .select({
      url: lumaFeeds.url,
      handle: handles.handle,
      stoppedAt: lumaFeeds.stopped_at,
      reason: lumaFeeds.last_failure,
      failures: lumaFeeds.failures,
    })
    .from(lumaFeeds)
    .leftJoin(communityLinks, eq(communityLinks.url, lumaFeeds.url))
    .leftJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communityLinks.community_id} AS TEXT)`),
      ),
    )
    .where(isNotNull(lumaFeeds.stopped_at))
    .orderBy(sql`${lumaFeeds.stopped_at} DESC`, asc(lumaFeeds.url))
    .limit(STOPPED_FEEDS)
    .all()
  return rows.flatMap((row): StoppedFeed[] =>
    row.stoppedAt === null || row.reason === null
      ? []
      : [
          {
            url: row.url,
            community:
              row.handle === null ? null : handleSchema.parse(row.handle),
            stoppedAt: row.stoppedAt,
            reason: row.reason,
            failures: row.failures,
          },
        ],
  )
}
