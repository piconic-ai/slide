import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks, mutes } from '../db/schema'

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

/** Returns true when a new mute was stored. */
export async function mute(
  database: D1Database,
  { muter, muted, now }: MutePair & { now: number },
): Promise<boolean> {
  if (muter === muted) return false
  const result = await drizzle(database)
    .insert(mutes)
    .values({ muter_user_id: muter, muted_user_id: muted, created_at: now })
    .onConflictDoNothing()
    .run()
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
