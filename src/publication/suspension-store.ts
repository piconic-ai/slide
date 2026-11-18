import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, suspensionRowSchema, suspensions } from '../db/schema'

export const notSuspended = sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
  WHERE ${suspensions.user_id} = ${decks.owner_user_id})`

/** The suspension of a GitHub user, or null when they are not suspended. */
export async function readSuspension(database: D1Database, userId: string) {
  const row = await drizzle(database)
    .select()
    .from(suspensions)
    .where(eq(suspensions.user_id, userId))
    .get()
    .then((result) => suspensionRowSchema.optional().parse(result))
  return row
    ? {
        reason: row.reason,
        suspendedAt: row.suspended_at,
        operator: row.suspended_by,
      }
    : null
}
