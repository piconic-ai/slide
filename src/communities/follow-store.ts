import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  accounts,
  communities,
  communityFollows,
  handles,
  suspensions,
} from '../db/schema'
import type { Handle } from '../share/handle'

/** One person and one community, as a follow names them. */
export type CommunityFollowPair = Readonly<{
  userId: string
  communityId: number
}>

const matchesPair = ({ userId, communityId }: CommunityFollowPair) =>
  and(
    eq(communityFollows.user_id, userId),
    eq(communityFollows.community_id, communityId),
  )

/** The number of the community that holds the handle, or null. */
export async function findCommunityIdByHandle(
  database: D1Database,
  handle: Handle,
): Promise<number | null> {
  const row = await drizzle(database)
    .select({ id: communities.id })
    .from(communities)
    .innerJoin(
      handles,
      and(
        eq(handles.handle, handle),
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
      ),
    )
    .get()
  return row?.id ?? null
}

/**
 * Stores the follow (F31-AC1). The person must hold an account and not be
 * suspended, and the community must exist, in the same statement, so a
 * follow that races either one going cannot outlive it. A block does not
 * stand in the way (F32-AC17), and nobody is told (D-54, F31-AC11).
 * Following again keeps the first follow's time.
 */
export async function followCommunity(
  database: D1Database,
  { userId, communityId, now }: CommunityFollowPair & { now: number },
): Promise<boolean> {
  const result = await drizzle(database).run(sql`
    INSERT INTO ${communityFollows} (user_id, community_id, created_at)
    SELECT ${accounts.user_id}, ${communities.id}, ${now}
    FROM ${accounts} JOIN ${communities} ON ${communities.id} = ${communityId}
    WHERE ${accounts.user_id} = ${userId}
      AND NOT EXISTS (SELECT 1 FROM ${suspensions}
        WHERE ${suspensions.user_id} = ${accounts.user_id})
      AND EXISTS (SELECT 1 FROM ${handles}
        WHERE ${handles.owner_kind} = 'community'
          AND ${handles.owner_id} = CAST(${communities.id} AS TEXT))
    ON CONFLICT DO NOTHING
  `)
  return result.meta.changes > 0
}

export async function unfollowCommunity(
  database: D1Database,
  pair: CommunityFollowPair,
) {
  await drizzle(database).delete(communityFollows).where(matchesPair(pair))
}

export async function isFollowingCommunity(
  database: D1Database,
  pair: CommunityFollowPair,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: communityFollows.community_id })
    .from(communityFollows)
    .where(matchesPair(pair))
    .get()
  return row !== undefined
}
