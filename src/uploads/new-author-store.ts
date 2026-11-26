import { and, eq, gt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks, deployments } from '../db/schema'
import type { PlacementCap } from './new-author-limits'

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
 * The new slides of the owner that count toward a new author's limit in the
 * window (F42-AC17, F42-AC19, F42-AC30): the one definition, used by the
 * insert that makes a slide and by the read that explains a refusal, so the
 * two cannot disagree. A slide is counted by the time it was made, once. It
 * counts when it holds a ready version, a deleted one included, or while its
 * first upload is still open. A slide whose first upload failed, expired or
 * was given up holds neither, so it is not counted.
 */
export function countedNewSlides(owner: string, cap: PlacementCap) {
  return and(
    eq(decks.owner_user_id, owner),
    gt(decks.created_at, cap.window.since),
    sql`EXISTS (SELECT 1 FROM ${deployments}
      WHERE ${deployments.deck_id} = ${decks.id}
        AND (${deployments.state} = 'ready'
          OR (${deployments.state} = 'uploading'
            AND ${deployments.expires_at} > ${cap.window.until})))`,
  )
}

/**
 * When each new slide of the person that counts (`countedNewSlides`) was
 * made, within the window of `cap` (F42-AC19). A new version of a slide is
 * not counted, and a slide the person deleted since still is, so that
 * deleting and putting up again does not make room.
 */
export async function readNewSlideTimes(
  database: D1Database,
  userId: string,
  cap: PlacementCap,
): Promise<number[]> {
  const rows = await drizzle(database)
    .select({ at: decks.created_at })
    .from(decks)
    .where(countedNewSlides(userId, cap))
  return rows.map((row) => row.at)
}
