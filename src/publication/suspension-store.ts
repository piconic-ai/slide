import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, suspensionRowSchema, suspensions } from '../db/schema'
import {
  decideSuspension,
  type Suspension,
  type SuspensionCommand,
  type SuspensionDecision,
} from './suspension'

export const notSuspended = sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
  WHERE ${suspensions.user_id} = ${decks.owner_user_id})`

/** The suspension of a GitHub user, or null when they are not suspended. */
export async function readSuspension(
  database: D1Database,
  userId: string,
): Promise<Suspension | null> {
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

export type SuspensionResult =
  | Readonly<{ kind: 'applied' }>
  | Exclude<SuspensionDecision, { kind: 'apply' }>

/** Concurrent suspensions store one row without replacing its details. */
export async function applySuspensionCommand(
  database: D1Database,
  input: Readonly<{ userId: string; command: SuspensionCommand; now: number }>,
): Promise<SuspensionResult> {
  const { userId, command, now } = input
  const current = await readSuspension(database, userId)
  const decision = decideSuspension(current, command, now)
  if (decision.kind !== 'apply') return decision
  const db = drizzle(database)
  const { next } = decision
  const saved = next
    ? await db
        .insert(suspensions)
        .values({
          user_id: userId,
          reason: next.reason,
          suspended_at: next.suspendedAt,
          suspended_by: next.operator,
        })
        .onConflictDoNothing()
        .returning({ userId: suspensions.user_id })
    : await db
        .delete(suspensions)
        .where(eq(suspensions.user_id, userId))
        .returning({ userId: suspensions.user_id })
  return { kind: saved.length > 0 ? 'applied' : 'unchanged' }
}
