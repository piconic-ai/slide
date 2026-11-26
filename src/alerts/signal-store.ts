import { and, count, eq, gte, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { alertSignals } from '../db/schema'
import { SIGNAL_KEEP_SECONDS } from './thresholds'

export { SIGNAL_KEEP_SECONDS }

/** Notes that `kind` happened at `now` (seconds), and drops what is a day old. */
export async function recordSignal(
  database: D1Database,
  kind: string,
  now: number,
): Promise<void> {
  const db = drizzle(database)
  await db.batch([
    db
      .delete(alertSignals)
      .where(lt(alertSignals.at, now - SIGNAL_KEEP_SECONDS)),
    db.insert(alertSignals).values({ kind, at: now }),
  ])
}

/** How many times `kind` happened from `since` (seconds) on. */
export async function countSignals(
  database: D1Database,
  kind: string,
  since: number,
): Promise<number> {
  const [row] = await drizzle(database)
    .select({ n: count() })
    .from(alertSignals)
    .where(and(eq(alertSignals.kind, kind), gte(alertSignals.at, since)))
  return row?.n ?? 0
}
