import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  communities,
  communityFollows,
  decks,
  deployments,
  handles,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { notBlockedBy } from '../blocks/store'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS, type CommunityColor } from '../site/cover-pattern'
import { inCommunity } from './store'
import type { DeckAfter } from '../site/home-more'

const feedRow = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  publishedAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
  communityHandle: handleSchema,
  communityName: z.string(),
  communityColor: z.enum(COMMUNITY_COLORS),
})

/**
 * A public slide of a community the reader follows, with the community it
 * is shown under: when it is in several, the one the reader followed first.
 * `readyAt` is when it was first published, which orders the list.
 */
export type FollowedCommunityTalk = Readonly<{
  handle: z.infer<typeof handleSchema>
  slug: z.infer<typeof deckSlugSchema>
  title: string | null
  readyAt: number
  deploymentId: string
  coverPath: string | null
  community: Readonly<{
    handle: z.infer<typeof handleSchema>
    name: string
    color: CommunityColor
  }>
}>

// When a deck was first published; a deck published before the column was
// added has the time its public version became ready.
const publishedAt = sql`coalesce(${decks.first_published_at}, ${deployments.ready_at})`

/**
 * The public slides in the communities the reader follows, each once with
 * the community it is shown under (`pick` 1): the slides readers may open
 * from a list (a ready public version, not taken down), but those of
 * authors the reader muted or blocked (F31-AC7, F32-AC4). The list and its
 * count read the same rows.
 */
const followedTalkRows = (viewer: string) => {
  const shown = and(
    eq(communityFollows.user_id, viewer),
    notHidden,
    notMutedBy(viewer),
    notBlockedBy(viewer),
  )
  return sql`
    SELECT * FROM (
      SELECT ${accounts.handle} AS handle, ${decks.slug} AS slug,
        ${deployments.title} AS title, ${publishedAt} AS publishedAt,
        ${deployments.id} AS deploymentId,
        ${deployments.cover_path} AS coverPath,
        ${handles.handle} AS communityHandle,
        ${communities.name} AS communityName,
        ${communities.color} AS communityColor,
        ROW_NUMBER() OVER (PARTITION BY ${decks.id}
          ORDER BY ${communityFollows.created_at}, ${communities.id}) AS pick
      FROM ${communityFollows}
      JOIN ${communities} ON ${communities.id} = ${communityFollows.community_id}
      JOIN ${handles} ON ${handles.owner_kind} = 'community'
        AND ${handles.owner_id} = CAST(${communities.id} AS TEXT)
      JOIN ${relatedLinkEvents}
        ON ${inCommunity(communityFollows.community_id, relatedLinkEvents.event_id)}
      JOIN ${relatedLinks} ON ${relatedLinks.id} = ${relatedLinkEvents.link_id}
      JOIN ${decks} ON ${decks.id} = ${relatedLinks.deck_id}
      JOIN ${accounts} ON ${accounts.user_id} = ${decks.owner_user_id}
      JOIN ${deployments} ON ${deployments.id} = ${decks.public_deployment_id}
        AND ${deployments.deck_id} = ${decks.id}
        AND ${deployments.state} = 'ready'
      WHERE ${shown}
    )
    WHERE pick = 1`
}

/** How many slides the whole list has, over all its pages (F31-AC5). */
export async function countFollowedCommunityTalks(
  database: D1Database,
  viewer: string,
): Promise<number> {
  const row = await drizzle(database).get<{ count: number }>(
    sql`SELECT count(*) AS count FROM (${followedTalkRows(viewer)})`,
  )
  return row?.count ?? 0
}

/**
 * One page of the public slides in the communities the reader follows,
 * the most recently published first, each slide once (F31-AC3, F31-AC5).
 * Not grouped by event.
 */
export async function listFollowedCommunityTalks(
  database: D1Database,
  query: Readonly<{
    viewer: string
    limit: number
    offset: number
    /** Read only the slides sorted after this one (F03-AC163). */
    after?: DeckAfter | null
  }>,
): Promise<readonly FollowedCommunityTalk[]> {
  const after = query.after
  const rows = await drizzle(database).all(sql`
    SELECT handle, slug, title, publishedAt, deploymentId, coverPath,
      communityHandle, communityName, communityColor
    FROM (${followedTalkRows(query.viewer)})
    ${
      after
        ? sql`WHERE publishedAt < ${after.at}
            OR (publishedAt = ${after.at} AND (handle > ${after.handle}
              OR (handle = ${after.handle} AND slug > ${after.slug})))`
        : sql``
    }
    ORDER BY publishedAt DESC, handle, slug
    LIMIT ${query.limit} OFFSET ${query.offset}
  `)
  return feedRow
    .array()
    .parse(rows)
    .map((row) => ({
      handle: row.handle,
      slug: row.slug,
      title: row.title,
      readyAt: row.publishedAt,
      deploymentId: row.deploymentId,
      coverPath: row.coverPath,
      community: {
        handle: row.communityHandle,
        name: row.communityName,
        color: row.communityColor,
      },
    }))
}
