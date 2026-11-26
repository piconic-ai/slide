import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { alerts } from '../db/schema'
import type { Notice } from './notice'

/** Rows older than this are dropped when the daily mail has been sent. */
export const KEEP_SECONDS = 30 * 24 * 60 * 60

type Row = typeof alerts.$inferSelect

/** What a row says, in the shape the operations page reads. */
export type AlertRecord = Readonly<{
  id: number
  kind: string
  count: number
  link: string
  task: string | null
  raisedAt: number
  state: Row['state']
}>

const recordOf = (row: Row): AlertRecord => ({
  id: row.id,
  kind: row.kind,
  count: row.count,
  link: row.link,
  task: row.task,
  raisedAt: row.raised_at,
  state: row.state,
})

/** What an alert told at once starts as: claimed, or without a webhook to tell. */
export type ClaimState = 'sending' | 'not_configured'

/**
 * Records an alert told at once, unless one of its kind was claimed, sent or
 * left unsent for want of a webhook within the last `throttleSeconds` (D-58).
 * Checking and recording are one statement, so alerts that arrive together
 * cannot all pass. The row's id when this alert may go on, null when it is
 * held back. A failed send does not hold back the next one.
 */
export async function claimImmediate(
  database: D1Database,
  notice: Notice,
  state: ClaimState,
  now: number,
  throttleSeconds: number,
): Promise<number | null> {
  const result = await drizzle(database).run(sql`
    INSERT INTO alerts (kind, urgency, count, link, task, raised_at, state)
    SELECT ${notice.kind}, 'immediate', ${notice.count}, ${notice.link},
      ${'task' in notice ? notice.task : null}, ${now}, ${state}
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts
      WHERE kind = ${notice.kind} AND urgency = 'immediate'
        AND state IN ('sending', 'sent', 'not_configured')
        AND raised_at > ${now - throttleSeconds}
    )`)
  return result.meta.changes > 0 ? result.meta.last_row_id : null
}

/** Records how the send ended. */
export async function finishImmediate(
  database: D1Database,
  id: number,
  state: 'sent' | 'failed',
): Promise<void> {
  await drizzle(database)
    .update(alerts)
    .set({ state })
    .where(and(eq(alerts.id, id), eq(alerts.state, 'sending')))
}

/** Keeps an alert for the next-day mail. */
export async function queueNextDay(
  database: D1Database,
  notice: Notice,
  now: number,
): Promise<void> {
  await drizzle(database)
    .insert(alerts)
    .values({
      kind: notice.kind,
      urgency: 'next_day',
      count: notice.count,
      link: notice.link,
      task: 'task' in notice ? notice.task : null,
      raised_at: now,
      state: 'queued',
    })
}

/** What is waiting for the next-day mail, oldest first. */
export async function listQueued(database: D1Database) {
  const rows = await drizzle(database)
    .select()
    .from(alerts)
    .where(eq(alerts.state, 'queued'))
    .orderBy(asc(alerts.id))
  return rows.map(recordOf)
}

/**
 * Marks as mailed what was queued up to the row `lastId`, the last one the
 * mail was made from. A row queued meanwhile has a later id and waits for
 * the next mail.
 */
export async function markMailed(
  database: D1Database,
  lastId: number,
  now: number,
): Promise<void> {
  await drizzle(database)
    .update(alerts)
    .set({ state: 'mailed', mailed_at: now })
    .where(and(eq(alerts.state, 'queued'), lte(alerts.id, lastId)))
}

/**
 * Drops what is older than `KEEP_SECONDS`, whatever its state: a mail that
 * has not been sent for that long is not one the operator still needs, and
 * the table must not grow for ever where no mail service is set up.
 */
export async function dropOldAlerts(
  database: D1Database,
  now: number,
): Promise<void> {
  await drizzle(database)
    .delete(alerts)
    .where(lt(alerts.raised_at, now - KEEP_SECONDS))
}

const limitSchema = z.number().int().min(1).max(100)

/** The newest alerts, the newest first: what the operations page lists. */
export async function listRecent(
  database: D1Database,
  limit: number,
): Promise<AlertRecord[]> {
  const rows = await drizzle(database)
    .select()
    .from(alerts)
    .orderBy(desc(alerts.raised_at), desc(alerts.id))
    .limit(limitSchema.parse(limit))
  return rows.map(recordOf)
}
