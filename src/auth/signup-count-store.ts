import { and, count, gte, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from '../db/schema'

const HOUR = 60 * 60
const DAY = 24 * HOUR
/** How far back the usual number of sign-ups is taken: 7 days before the last hour. */
const BASELINE = 7 * DAY

export type SignupCountsOfNow = Readonly<{
  /** Registered within the last hour. */
  lastHour: number
  /** Registered within the last 24 hours (the last hour included). */
  lastDay: number
  /** Registered in the 7 days before the last hour. */
  baseline: number
}>

/**
 * How many people registered, by when they made their account
 * (`accounts.created_at`, seconds). Only counts: nothing of who.
 */
export async function readSignupCounts(
  database: D1Database,
  now: number,
): Promise<SignupCountsOfNow> {
  const db = drizzle(database)
  const between = (from: number, until: number | null) =>
    db
      .select({ n: count() })
      .from(accounts)
      .where(
        and(
          gte(accounts.created_at, from),
          until === null ? undefined : lt(accounts.created_at, until),
        ),
      )
  const [[hour], [day], [week]] = await db.batch([
    between(now - HOUR, null),
    between(now - DAY, null),
    between(now - HOUR - BASELINE, now - HOUR),
  ])
  return {
    lastHour: hour?.n ?? 0,
    lastDay: day?.n ?? 0,
    baseline: week?.n ?? 0,
  }
}
