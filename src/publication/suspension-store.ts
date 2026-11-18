import { and, eq, sql } from 'drizzle-orm'
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

/**
 * Stores `next` only if the account's suspension is still `from`, the one
 * the decision was made from. A release decided against one suspension never
 * removes a later one, and a suspension never replaces one stored first.
 * Returns false when nothing matched.
 */
export async function saveSuspension(
  database: D1Database,
  input: Readonly<{
    userId: string
    from: Suspension | null
    next: Suspension | null
  }>,
): Promise<boolean> {
  const db = drizzle(database)
  const { userId, from, next } = input
  if (next) {
    if (from) return false
    const saved = await db
      .insert(suspensions)
      .values({
        user_id: userId,
        reason: next.reason,
        suspended_at: next.suspendedAt,
        suspended_by: next.operator,
      })
      .onConflictDoNothing()
      .returning({ userId: suspensions.user_id })
    return saved.length > 0
  }
  if (!from) return false
  const removed = await db
    .delete(suspensions)
    .where(
      and(
        eq(suspensions.user_id, userId),
        eq(suspensions.suspended_at, from.suspendedAt),
        eq(suspensions.reason, from.reason),
        eq(suspensions.suspended_by, from.operator),
      ),
    )
    .returning({ userId: suspensions.user_id })
  return removed.length > 0
}

/** Applies an operator's command; a command that lost a race is unchanged. */
export async function applySuspensionCommand(
  database: D1Database,
  input: Readonly<{ userId: string; command: SuspensionCommand; now: number }>,
): Promise<SuspensionResult> {
  const { userId, command, now } = input
  const current = await readSuspension(database, userId)
  const decision = decideSuspension(current, command, now)
  if (decision.kind !== 'apply') return decision
  const saved = await saveSuspension(database, {
    userId,
    from: current,
    next: decision.next,
  })
  return { kind: saved ? 'applied' : 'unchanged' }
}
