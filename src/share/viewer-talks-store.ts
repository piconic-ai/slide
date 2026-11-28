import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { notBlockedBy } from '../blocks/store'
import { inCommunity } from '../communities/store'
import {
  accounts,
  decks,
  deployments,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from './handle'
import type { ViewerEvent } from './viewer-events-frame'
import { SECTION_TALKS, type TalksRead } from './viewer-talks'

/**
 * How many talks each list reads: a section's worth, and as many again for
 * those the viewer's citations already show (DECKS_SHOWN on either side),
 * which the sections leave out.
 */
const READ_TALKS = SECTION_TALKS * 2

const talkSchema = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
  at: z.number().int(),
})

// When a deck was first published; a deck published before the column was
// added has the time its public version became ready.
const publishedAt = sql<number>`coalesce(${decks.first_published_at}, ${deployments.ready_at})`

/** The deck is a talk of the event: one of its related links names it. */
const talkOf = (eventId: number) =>
  sql`EXISTS (SELECT 1 FROM ${relatedLinkEvents} AS mine
    JOIN ${relatedLinks} AS mine_link ON mine_link.id = mine.link_id
    WHERE mine_link.deck_id = ${decks.id} AND mine.event_id = ${eventId})`

/**
 * The public talks of the events `where` picks, each deck once, newest
 * first, as readers may open them from a list: a ready public version, not
 * taken down or deleted, not by someone the viewer muted or blocked, and
 * not the slides being viewed.
 */
const listTalks = (
  database: D1Database,
  input: Readonly<{ deckId: string; viewer: string | null; where: SQL }>,
) =>
  drizzle(database)
    .selectDistinct({
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
      at: publishedAt.as('published_at'),
    })
    .from(relatedLinkEvents)
    .innerJoin(relatedLinks, eq(relatedLinks.id, relatedLinkEvents.link_id))
    .innerJoin(
      decks,
      and(
        eq(decks.id, relatedLinks.deck_id),
        ne(decks.id, input.deckId),
        isNull(decks.deleted_at),
        notHidden,
        notMutedBy(input.viewer),
        notBlockedBy(input.viewer),
      ),
    )
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(input.where)
    .orderBy(sql`published_at DESC`, accounts.handle, decks.slug)
    .limit(READ_TALKS)
    .all()
    .then((rows) => talkSchema.array().parse(rows))

/**
 * What the viewer's sections of other talks are made from (D-56, D-57):
 * the first event the slides were presented at, its other public talks, and
 * its community's other events' talks. Null when the slides were presented
 * at no event.
 */
export async function readViewerTalks(
  database: D1Database,
  input: Readonly<{
    deckId: string
    events: readonly ViewerEvent[]
    viewer: string | null
  }>,
): Promise<TalksRead | null> {
  const [event] = input.events
  if (!event) return null
  const { deckId, viewer } = input
  const [sameEvent, otherEvents] = await Promise.all([
    listTalks(database, {
      deckId,
      viewer,
      where: eq(relatedLinkEvents.event_id, event.id),
    }),
    event.community === null
      ? []
      : listTalks(database, {
          deckId,
          viewer,
          // Of events only (F24-AC41): the events of the community, not the
          // slides its other links bring in (`deckInCommunity`).
          where: and(
            inCommunity(event.community.id, relatedLinkEvents.event_id),
            sql`NOT ${talkOf(event.id)}`,
          )!,
        }),
  ])
  return { event, sameEvent, otherEvents }
}
