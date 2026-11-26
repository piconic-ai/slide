import { and, gte, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, metricDaily } from '../db/schema'
import { startOfDay } from './day'
import type { DailyTotal } from './table'
import type { Week } from './weeks'

/**
 * The copied days from `from` to `to` (both included), added up over the
 * languages: what the weekly table is made of.
 */
export async function readDailyTotals(
  database: D1Database,
  from: string,
  to: string,
): Promise<readonly DailyTotal[]> {
  const rows = await drizzle(database)
    .select({
      day: metricDaily.day,
      event: metricDaily.event,
      detail: metricDaily.detail,
      referrer: metricDaily.referrer,
      screen: metricDaily.screen,
      events: sql<number>`SUM(${metricDaily.events})`,
      valueSum: sql<number>`SUM(${metricDaily.value_sum})`,
    })
    .from(metricDaily)
    .where(and(gte(metricDaily.day, from), lte(metricDaily.day, to)))
    .groupBy(
      metricDaily.day,
      metricDaily.event,
      metricDaily.detail,
      metricDaily.referrer,
      metricDaily.screen,
    )
  return rows.map((row) => ({
    ...row,
    events: Number(row.events),
    valueSum: Number(row.valueSum),
  }))
}

const WEEK_SECONDS = 7 * 24 * 60 * 60

/**
 * How many authors put at least one version up (one that became ready) in
 * each week, counted from D1 itself, so the number is exact and not an
 * estimate from sampled records (D-72). The weeks are those given, one
 * after another from the first; the answer has a count for each.
 */
export async function readAuthorsByWeek(
  database: D1Database,
  weeks: readonly Week[],
): Promise<readonly number[]> {
  const first = weeks[0]
  if (!first) return []
  const from = startOfDay(first.start)
  const until = from + weeks.length * WEEK_SECONDS
  // Whole numbers made here, so they go into the text: a bound value in a
  // grouped expression is a different value from the one selected.
  const origin = sql.raw(String(Math.trunc(from)))
  const width = sql.raw(String(WEEK_SECONDS))
  const week = sql<number>`(${deployments.ready_at} - ${origin}) / ${width}`
  const rows = await drizzle(database)
    .select({
      week,
      authors: sql<number>`COUNT(DISTINCT ${decks.owner_user_id})`,
    })
    .from(deployments)
    .innerJoin(decks, sql`${decks.id} = ${deployments.deck_id}`)
    .where(
      and(
        gte(deployments.ready_at, from),
        sql`${deployments.ready_at} < ${until}`,
      ),
    )
    .groupBy(week)
  const counts = weeks.map(() => 0)
  for (const row of rows) counts[Number(row.week)] = Number(row.authors)
  return counts
}
