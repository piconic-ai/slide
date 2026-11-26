import { count, gte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { lumaFeeds, reports } from '../db/schema'

/** How many reports were made from `since` (seconds) on. */
export async function countReportsSince(
  database: D1Database,
  since: number,
): Promise<number> {
  const [row] = await drizzle(database)
    .select({ n: count() })
    .from(reports)
    .where(gte(reports.created_at, since))
  return row?.n ?? 0
}

/** How many Luma feeds were stopped from `since` (seconds) on. */
export async function countStoppedFeedsSince(
  database: D1Database,
  since: number,
): Promise<number> {
  const [row] = await drizzle(database)
    .select({ n: count() })
    .from(lumaFeeds)
    .where(gte(lumaFeeds.stopped_at, since))
  return row?.n ?? 0
}

/**
 * The size of D1 in bytes: the `size_after` of a query that changes nothing
 * (https://developers.cloudflare.com/d1/worker-api/return-object/). It
 * throws when D1 does not say, so a size that cannot be read is a failure
 * that is told, not a silence.
 */
export async function measureD1Size(database: D1Database): Promise<number> {
  const { meta } = await database.prepare('SELECT 1').run()
  const size: unknown = meta.size_after
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0)
    throw new RangeError('D1 did not report its size')
  return size
}
