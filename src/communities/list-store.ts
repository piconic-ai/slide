import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { communities, communityFollows, handles } from '../db/schema'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import type { CommunityAfter } from '../site/home-more'
import type { ListedCommunity } from './community-card'

/** A community that stands holds a handle; one being deleted may not. */
const holdsHandle = and(
  eq(handles.owner_kind, 'community'),
  eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
)

const listedRow = z.object({
  id: z.number().int().positive(),
  handle: handleSchema,
  name: z.string(),
  description: z.string(),
  color: z.enum(COMMUNITY_COLORS),
  logoAt: z.number().int().nullable(),
  coverAt: z.number().int().nullable(),
  createdAt: z.number().int(),
})

/**
 * One page of every community, the newest made first (F30-AC47). Whether
 * it has talks, and who made it, change nothing: a community is not a
 * person, so one made by someone the reader blocked is listed too.
 */
export async function listNewCommunities(
  database: D1Database,
  query: Readonly<{
    limit: number
    offset: number
    /** Read only the communities sorted after this one (F03-AC163). */
    after?: CommunityAfter | null
    /** Leave out the communities this person follows (F34-AC18). */
    notFollowedBy?: string | null
  }>,
): Promise<readonly ListedCommunity[]> {
  const after = query.after
  const rows = await drizzle(database)
    .select({
      id: communities.id,
      handle: handles.handle,
      name: communities.name,
      description: communities.description,
      color: communities.color,
      logoAt: communities.logo_at,
      coverAt: communities.cover_at,
      createdAt: communities.created_at,
    })
    .from(communities)
    .innerJoin(handles, holdsHandle)
    .where(
      and(
        after
          ? sql`(${communities.created_at} < ${after.at}
            OR (${communities.created_at} = ${after.at}
              AND ${communities.id} < ${after.id}))`
          : undefined,
        query.notFollowedBy
          ? sql`NOT EXISTS (SELECT 1 FROM ${communityFollows}
              WHERE ${communityFollows.user_id} = ${query.notFollowedBy}
                AND ${communityFollows.community_id} = ${communities.id})`
          : undefined,
      ),
    )
    // Communities made in the same second keep one order across pages.
    .orderBy(desc(communities.created_at), desc(communities.id))
    .limit(query.limit)
    .offset(query.offset)
  return listedRow.array().parse(rows)
}

/** How many communities the whole list has, over all its pages. */
export async function countCommunities(database: D1Database): Promise<number> {
  const [row] = await drizzle(database)
    .select({ count: sql<number>`count(*)` })
    .from(communities)
    .innerJoin(handles, holdsHandle)
  return row?.count ?? 0
}
