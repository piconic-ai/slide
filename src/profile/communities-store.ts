import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  communities,
  communityAdmins,
  communityFollows,
  decks,
  deployments,
  handles,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { notBlockedBy } from '../blocks/store'
import type { CommunityTalk } from '../communities/community'
import { countPeopleQuery } from '../follows/store'
import { inCommunity } from '../communities/store'
import { deckSlugSchema } from '../decks/deck-id'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema, type Handle } from '../share/handle'
import { COMMUNITY_COLORS, type CommunityColor } from '../site/cover-pattern'

/** Whose followed communities are read, and who reads them. */
export type FollowedCommunitiesQuery = Readonly<{
  of: string
  /** The signed-in reader, whose follows mark the buttons. */
  viewer: string | null
}>

/** A community an author follows, as their communities tab lists it. */
export type FollowedCommunity = Readonly<{
  id: number
  handle: Handle
  name: string
  color: CommunityColor
  logoAt: number | null
  /** Whether the author runs it, which the key beside its name says. */
  admin: boolean
  /** Whether the reader of the tab follows it too. */
  followedByViewer: boolean
}>

const followedBy = (of: string) => eq(communityFollows.user_id, of)

/** A community that stands holds a handle; one being deleted may not. */
const communityHandle = and(
  eq(handles.owner_kind, 'community'),
  eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
)

/**
 * The query that counts the communities an author follows: the count
 * beside the "communities" tab (F31-AC8). A community being deleted, which
 * holds no handle, is not counted, as the list does not show it.
 */
const countFollowedCommunitiesQuery = (db: DrizzleD1Database, of: string) =>
  db
    .select({ count: sql<number>`count(*)` })
    .from(communityFollows)
    .innerJoin(communities, eq(communities.id, communityFollows.community_id))
    .innerJoin(handles, communityHandle)
    .where(followedBy(of))

/**
 * The counts beside a profile's tabs of follows, the people it follows,
 * its followers and the communities it follows, as this reader may see
 * them: one batch, one trip to D1, for every profile page.
 */
export async function countProfileFollows(
  database: D1Database,
  query: FollowedCommunitiesQuery,
): Promise<
  Readonly<{ following: number; followers: number; communities: number }>
> {
  const db = drizzle(database)
  const [following, followers, followed] = await db.batch([
    countPeopleQuery(db, { ...query, list: 'following' }),
    countPeopleQuery(db, { ...query, list: 'followers' }),
    countFollowedCommunitiesQuery(db, query.of),
  ])
  const countOf = (rows: readonly { count: number }[]) => rows[0]?.count ?? 0
  return {
    following: countOf(following),
    followers: countOf(followers),
    communities: countOf(followed),
  }
}

const followedRow = z.object({
  id: z.number().int().positive(),
  handle: handleSchema,
  name: z.string(),
  color: z.enum(COMMUNITY_COLORS),
  logoAt: z.number().int().nullable(),
  admin: z.number().int(),
  followedByViewer: z.number().int(),
})

/**
 * One page of the communities an author follows, the newest follow first
 * (F31-AC8, D-53). Anyone may read it (F31-AC9).
 */
export async function listFollowedCommunities(
  database: D1Database,
  query: FollowedCommunitiesQuery & Readonly<{ limit: number; offset: number }>,
): Promise<readonly FollowedCommunity[]> {
  const rows = await drizzle(database)
    .select({
      id: communities.id,
      handle: handles.handle,
      name: communities.name,
      color: communities.color,
      logoAt: communities.logo_at,
      admin: sql<number>`EXISTS (SELECT 1 FROM ${communityAdmins}
        WHERE ${communityAdmins.community_id} = ${communities.id}
          AND ${communityAdmins.user_id} = ${query.of})`,
      followedByViewer:
        query.viewer === null
          ? sql<number>`0`
          : sql<number>`EXISTS (SELECT 1 FROM ${communityFollows} AS own
              WHERE own.user_id = ${query.viewer}
                AND own.community_id = ${communities.id})`,
    })
    .from(communityFollows)
    .innerJoin(communities, eq(communities.id, communityFollows.community_id))
    .innerJoin(handles, communityHandle)
    .where(followedBy(query.of))
    // Follows made in the same second keep one order across pages.
    .orderBy(desc(communityFollows.created_at), communities.id)
    .limit(query.limit)
    .offset(query.offset)
  return followedRow
    .array()
    .parse(rows)
    .map((row) => ({
      ...row,
      admin: row.admin === 1,
      followedByViewer: row.followedByViewer === 1,
    }))
}

const talkRow = z.object({
  communityId: z.number().int(),
  deckId: z.string(),
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  publishedAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
})

// When a deck was first published; a deck published before the column was
// added has the time its public version became ready.
const publishedAt = sql`coalesce(${decks.first_published_at}, ${deployments.ready_at})`

/**
 * The newest public slides of each community, up to `each` (F31-AC8,
 * D-53): the slides readers may open from a list, but those of authors the
 * reader muted or blocked (F32-AC4), each once in a community.
 */
export async function listRecentCommunityTalks(
  database: D1Database,
  query: Readonly<{
    communityIds: readonly number[]
    viewer: string | null
    each: number
  }>,
): Promise<ReadonlyMap<number, readonly CommunityTalk[]>> {
  const talks = new Map<number, CommunityTalk[]>()
  if (query.communityIds.length === 0) return talks
  const shown = and(
    inArray(communities.id, [...query.communityIds]),
    notHidden,
    notMutedBy(query.viewer),
    notBlockedBy(query.viewer),
  )
  const rows = await drizzle(database).all(sql`
    SELECT communityId, deckId, handle, slug, title, publishedAt,
      deploymentId, coverPath
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY communityId
        ORDER BY publishedAt DESC, handle, slug) AS rank
      FROM (
        SELECT DISTINCT ${communities.id} AS communityId,
          ${decks.id} AS deckId, ${accounts.handle} AS handle,
          ${decks.slug} AS slug, ${deployments.title} AS title,
          ${publishedAt} AS publishedAt, ${deployments.id} AS deploymentId,
          ${deployments.cover_path} AS coverPath
        FROM ${communities}
        JOIN ${relatedLinkEvents}
          ON ${inCommunity(communities.id, relatedLinkEvents.event_id)}
        JOIN ${relatedLinks} ON ${relatedLinks.id} = ${relatedLinkEvents.link_id}
        JOIN ${decks} ON ${decks.id} = ${relatedLinks.deck_id}
        JOIN ${accounts} ON ${accounts.user_id} = ${decks.owner_user_id}
        JOIN ${deployments} ON ${deployments.id} = ${decks.public_deployment_id}
          AND ${deployments.deck_id} = ${decks.id}
          AND ${deployments.state} = 'ready'
        WHERE ${shown}
      )
    )
    WHERE rank <= ${query.each}
    ORDER BY communityId, rank
  `)
  for (const row of talkRow.array().parse(rows)) {
    const { communityId, ...talk } = row
    talks.set(communityId, [...(talks.get(communityId) ?? []), talk])
  }
  return talks
}
