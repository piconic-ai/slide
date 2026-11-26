import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { notBlocking, notBlockedBy } from '../blocks/store'
import { inCommunity } from '../communities/store'
import {
  accounts,
  communities,
  communityFollows,
  decks,
  deployments,
  follows,
  handles,
  mutes,
  profilePictures,
  profiles,
  relatedLinkEvents,
  relatedLinks,
  suspensions,
} from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { personColumns, toPerson, type Person } from '../follows/store'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS } from './cover-pattern'
import type { FollowingSlide } from './home-discover'
import type { DeckAfter } from './home-more'

const followingRow = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  readyAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
  viaPerson: z.number().int(),
  communityHandle: handleSchema.nullable(),
  communityName: z.string().nullable(),
  communityColor: z.enum(COMMUNITY_COLORS).nullable(),
})

/**
 * The communities the viewer follows each public slide is in, one row per
 * slide: the one the viewer followed first. A slide in several of them is
 * one row, so it is listed once.
 */
const communityOfSlide = (viewer: string) => sql`
  SELECT deckId, communityHandle, communityName, communityColor FROM (
    SELECT ${decks.id} AS deckId, ${handles.handle} AS communityHandle,
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
    WHERE ${communityFollows.user_id} = ${viewer}
  ) WHERE pick = 1`

/**
 * One page of the public slides of the people and the communities the viewer
 * follows, as one list, the most recently published first (F44-AC5). A slide
 * that fits several of them is one row; it carries both whether its author is
 * followed and the community, which the page chooses between. The slides are
 * those readers may open from a list, less the authors the viewer muted or
 * blocked (F44-AC6). The order and the cursor are the recent list's, so a
 * list of "show more" reads on from the last slide as the recent list does.
 */
export async function listFollowingSlides(
  database: D1Database,
  query: Readonly<{
    viewer: string
    limit: number
    /** Read only the slides sorted after this one (F44-AC13). */
    after?: DeckAfter | null
  }>,
): Promise<readonly FollowingSlide[]> {
  const { viewer, after } = query
  const rows = await drizzle(database).all(sql`
    SELECT ${accounts.handle} AS handle, ${decks.slug} AS slug,
      ${deployments.title} AS title, ${deployments.ready_at} AS readyAt,
      ${deployments.id} AS deploymentId,
      ${deployments.cover_path} AS coverPath,
      EXISTS (SELECT 1 FROM ${follows}
        WHERE ${follows.follower_user_id} = ${viewer}
          AND ${follows.followee_user_id} = ${decks.owner_user_id}) AS viaPerson,
      via.communityHandle AS communityHandle,
      via.communityName AS communityName,
      via.communityColor AS communityColor
    FROM ${accounts}
    JOIN ${decks} ON ${decks.owner_user_id} = ${accounts.user_id}
    JOIN ${deployments} ON ${deployments.id} = ${decks.public_deployment_id}
      AND ${deployments.deck_id} = ${decks.id}
      AND ${deployments.state} = 'ready'
    LEFT JOIN (${communityOfSlide(viewer)}) AS via ON via.deckId = ${decks.id}
    WHERE ${and(
      notHidden,
      notMutedBy(viewer),
      notBlockedBy(viewer),
      sql`(via.deckId IS NOT NULL OR EXISTS (SELECT 1 FROM ${follows}
        WHERE ${follows.follower_user_id} = ${viewer}
          AND ${follows.followee_user_id} = ${decks.owner_user_id}))`,
      after
        ? sql`(${deployments.ready_at} < ${after.at}
            OR (${deployments.ready_at} = ${after.at} AND (
              ${accounts.handle} > ${after.handle}
              OR (${accounts.handle} = ${after.handle}
                AND ${decks.slug} > ${after.slug}))))`
        : undefined,
    )}
    ORDER BY ${deployments.ready_at} DESC, ${accounts.handle}, ${decks.slug}
    LIMIT ${query.limit}
  `)
  return followingRow
    .array()
    .parse(rows)
    .map((row) => ({
      handle: row.handle,
      slug: row.slug,
      title: row.title,
      readyAt: row.readyAt,
      deploymentId: row.deploymentId,
      coverPath: row.coverPath,
      viaPerson: row.viaPerson === 1,
      community:
        row.communityHandle === null ||
        row.communityName === null ||
        row.communityColor === null
          ? null
          : {
              handle: row.communityHandle,
              name: row.communityName,
              color: row.communityColor,
            },
    }))
}

/**
 * The people who registered most recently, for the carousel (F44-AC17),
 * whether or not they published a slide. Left out: the viewer, the people
 * they follow or muted or blocked, those who blocked them (a follow would be
 * refused), and suspended people. Without a viewer, only the suspended are
 * left out.
 */
export async function listNewPeople(
  database: D1Database,
  query: Readonly<{ viewer: string | null; limit: number }>,
): Promise<Person[]> {
  const { viewer } = query
  const person = accounts.user_id
  const rows = await drizzle(database)
    .select(personColumns(viewer))
    .from(accounts)
    .leftJoin(suspensions, eq(suspensions.user_id, person))
    .leftJoin(profiles, eq(profiles.user_id, person))
    .leftJoin(profilePictures, eq(profilePictures.user_id, person))
    .where(
      and(
        isNull(suspensions.user_id),
        viewer === null
          ? undefined
          : and(
              sql`${person} <> ${viewer}`,
              sql`NOT EXISTS (SELECT 1 FROM ${follows}
                WHERE ${follows.follower_user_id} = ${viewer}
                  AND ${follows.followee_user_id} = ${person})`,
              sql`NOT EXISTS (SELECT 1 FROM ${mutes}
                WHERE ${mutes.muter_user_id} = ${viewer}
                  AND ${mutes.muted_user_id} = ${person})`,
              notBlocking(viewer, person),
              notBlocking(person, viewer),
            ),
      ),
    )
    // People who registered in the same second keep one order.
    .orderBy(desc(accounts.created_at), desc(accounts.user_id))
    .limit(query.limit)
  return rows.map(toPerson)
}
