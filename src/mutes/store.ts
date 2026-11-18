import { and, desc, eq, exists, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks, follows, mutes, suspensions } from '../db/schema'

export function notMutedBy(viewer: string | null) {
  if (viewer === null) return undefined
  return sql`NOT EXISTS (SELECT 1 FROM ${mutes}
    WHERE ${mutes.muter_user_id} = ${viewer}
      AND ${mutes.muted_user_id} = ${decks.owner_user_id})`
}

type MutePair = Readonly<{ muter: string; muted: string }>

export async function hasMuted(
  database: D1Database,
  { muter, muted }: MutePair,
) {
  const row = await drizzle(database)
    .select({ userId: mutes.muted_user_id })
    .from(mutes)
    .where(and(eq(mutes.muter_user_id, muter), eq(mutes.muted_user_id, muted)))
    .get()
  return row !== undefined
}

/**
 * Returns true when a new mute was stored. Both people must hold an
 * account in the same statement, so a mute that races either one leaving
 * cannot outlive it.
 */
export async function mute(
  database: D1Database,
  { muter, muted, now }: MutePair & { now: number },
): Promise<boolean> {
  if (muter === muted) return false
  const db = drizzle(database)
  const eligible = db
    .select({
      muter_user_id: sql<string>`${muter}`.as('muter_user_id'),
      muted_user_id: accounts.user_id,
      created_at: sql<number>`${now}`.as('created_at'),
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.user_id, muted),
        sql`EXISTS (SELECT 1 FROM ${accounts} AS muter
          WHERE muter.user_id = ${muter})`,
        // A suspension that lands after the route's check still stops it.
        sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
          WHERE ${suspensions.user_id} IN (${muter}, ${muted}))`,
      ),
    )
  const [result] = await db.batch([
    db.insert(mutes).select(eligible).onConflictDoNothing(),
    db
      .delete(follows)
      .where(
        and(
          eq(follows.follower_user_id, muter),
          eq(follows.followee_user_id, muted),
          exists(eligible),
        ),
      ),
  ])
  return result.meta.changes > 0
}

export async function unmute(database: D1Database, { muter, muted }: MutePair) {
  await drizzle(database)
    .delete(mutes)
    .where(and(eq(mutes.muter_user_id, muter), eq(mutes.muted_user_id, muted)))
}

export function listMuted(database: D1Database, muter: string) {
  return drizzle(database)
    .select({ userId: accounts.user_id, handle: accounts.handle })
    .from(mutes)
    .innerJoin(accounts, eq(accounts.user_id, mutes.muted_user_id))
    .where(eq(mutes.muter_user_id, muter))
    .orderBy(desc(mutes.created_at), mutes.muted_user_id)
    .all()
}
