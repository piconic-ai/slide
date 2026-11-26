import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { metricDaily, metricDays } from '../db/schema'
import type { Day } from './day'
import type { DayCopy } from './day-rows'

/** The days of `from` to `to` (both included) that are already copied. */
export async function readCopiedDays(
  database: D1Database,
  from: Day,
  to: Day,
): Promise<ReadonlySet<string>> {
  const rows = await drizzle(database)
    .select({ day: metricDays.day })
    .from(metricDays)
    .where(and(gte(metricDays.day, from), lte(metricDays.day, to)))
  return new Set(rows.map((row) => row.day))
}

/**
 * Writes one day's copy, **in place of** what the day held: the day's lines
 * are deleted and the new ones inserted, and the day is marked copied, all
 * in one batch, which D1 runs as a transaction. Copying a day again, or after
 * a copy that stopped halfway, leaves exactly the last copy, so no count is
 * ever doubled (F40-AC17).
 */
export async function replaceDay(
  database: D1Database,
  day: Day,
  copy: DayCopy,
  at: number,
): Promise<void> {
  const db = drizzle(database)
  await db.batch([
    db.delete(metricDaily).where(eq(metricDaily.day, day)),
    ...copy.rows.map((row) =>
      db.insert(metricDaily).values({
        day,
        event: row.event,
        detail: row.detail,
        referrer: row.referrer,
        lang: row.lang,
        screen: row.screen,
        events: row.events,
        value_sum: row.valueSum,
      }),
    ),
    db
      .insert(metricDays)
      .values({
        day,
        copied_at: at,
        row_count: copy.rows.length,
        was_cut: copy.truncated ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: metricDays.day,
        set: {
          copied_at: at,
          row_count: copy.rows.length,
          was_cut: copy.truncated ? 1 : 0,
        },
      }),
  ])
}

/** The newest copied day and when it was copied, or null before any. */
export async function readLastCopy(database: D1Database): Promise<Readonly<{
  day: string
  copiedAt: number
  truncated: boolean
}> | null> {
  const row = await drizzle(database)
    .select()
    .from(metricDays)
    .orderBy(desc(metricDays.day))
    .limit(1)
    .get()
  return row
    ? { day: row.day, copiedAt: row.copied_at, truncated: row.was_cut === 1 }
    : null
}
