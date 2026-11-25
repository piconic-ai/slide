import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  accounts,
  communityFollows,
  mutes,
  profilePictures,
  profiles,
  suspensions,
} from '../db/schema'
import { personColumns, toPerson, type Person } from '../follows/store'

/** Whose followers are read, and who reads them. */
export type CommunityFollowersQuery = Readonly<{
  communityId: number
  /** The signed-in reader, whose mutes shape what they see. */
  viewer: string | null
}>

/**
 * Which follows the followers tab shows, once joined to the people: as in a
 * person's lists (src/follows/store.ts), a person who left has no account,
 * a suspended person is shown to nobody, and a person the reader muted is
 * not shown to that reader. The count and the list share this.
 */
const shownTo = ({ communityId, viewer }: CommunityFollowersQuery) =>
  and(
    eq(communityFollows.community_id, communityId),
    isNull(suspensions.user_id),
    viewer === null
      ? undefined
      : sql`NOT EXISTS (SELECT 1 FROM ${mutes}
          WHERE ${mutes.muter_user_id} = ${viewer}
            AND ${mutes.muted_user_id} = ${communityFollows.user_id})`,
  )

/** How many people follow a community, beside its followers tab (F31-AC10). */
export async function countCommunityFollowers(
  database: D1Database,
  query: CommunityFollowersQuery,
): Promise<number> {
  const row = await drizzle(database)
    .select({ count: sql<number>`count(*)` })
    .from(communityFollows)
    .innerJoin(accounts, eq(accounts.user_id, communityFollows.user_id))
    .leftJoin(suspensions, eq(suspensions.user_id, communityFollows.user_id))
    .where(shownTo(query))
    .get()
  return row?.count ?? 0
}

/** One page of a community's followers, the newest follow first (F31-AC10). */
export async function listCommunityFollowers(
  database: D1Database,
  query: CommunityFollowersQuery & Readonly<{ limit: number; offset: number }>,
): Promise<Person[]> {
  const person = communityFollows.user_id
  const rows = await drizzle(database)
    .select(personColumns(query.viewer))
    .from(communityFollows)
    .innerJoin(accounts, eq(accounts.user_id, person))
    .leftJoin(suspensions, eq(suspensions.user_id, person))
    .leftJoin(profiles, eq(profiles.user_id, person))
    .leftJoin(profilePictures, eq(profilePictures.user_id, person))
    .where(shownTo(query))
    // Follows made in the same second keep one order across pages.
    .orderBy(desc(communityFollows.created_at), person)
    .limit(query.limit)
    .offset(query.offset)
  return rows.map(toPerson)
}
