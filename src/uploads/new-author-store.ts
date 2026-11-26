import { and, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks } from '../db/schema'

/** When the person made their account (seconds), or null if they have none. */
export async function readRegisteredAt(
  database: D1Database,
  userId: string,
): Promise<number | null> {
  const row = await drizzle(database)
    .select({ at: accounts.created_at })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .get()
  return row?.at ?? null
}

/**
 * When each new slide of the person was made, after `since` (seconds)
 * (F42-AC19). A slide is counted once, the time it was made, however many
 * versions it gets after, so a new version of a slide is not counted. Slides
 * the person deleted since still count, so that deleting and putting up again
 * does not make room.
 */
export async function readNewSlideTimes(
  database: D1Database,
  userId: string,
  since: number,
): Promise<number[]> {
  const rows = await drizzle(database)
    .select({ at: decks.created_at })
    .from(decks)
    .where(and(eq(decks.owner_user_id, userId), gt(decks.created_at, since)))
  return rows.map((row) => row.at)
}
