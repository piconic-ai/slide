import { notBlockedBy } from '../blocks/store'
import { and, asc, desc, eq, inArray, min, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  decks,
  deployments,
  events,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { deckSlugSchema, type DeckSlug } from '../decks/deck-id'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema, type Handle } from '../share/handle'
import { communityHref } from '../communities/community'
import { listEventCommunities } from '../communities/event-communities-store'
import type { DeckEvent } from './deck-event'
import type { EventService } from './event-url'

/**
 * The events a deck is a talk of, once each, in the order their first link
 * was added, each with the community it is shown with, if any.
 */
export async function listDeckEvents(
  database: D1Database,
  deckId: string,
): Promise<readonly DeckEvent[]> {
  const rows = await drizzle(database)
    .select({
      id: events.id,
      service: events.service,
      ref: events.ref,
      host: events.host,
      name: events.name,
      first: min(relatedLinks.position),
    })
    .from(relatedLinks)
    .innerJoin(
      relatedLinkEvents,
      eq(relatedLinkEvents.link_id, relatedLinks.id),
    )
    .innerJoin(events, eq(events.id, relatedLinkEvents.event_id))
    .where(eq(relatedLinks.deck_id, deckId))
    .groupBy(events.id)
    .orderBy(asc(min(relatedLinks.position)))
    .all()
  const shown = await listEventCommunities(
    database,
    rows.map((row) => row.id),
  )
  return rows.map(({ first: _, ...event }) => {
    const community = shown.get(event.id)
    return {
      ...event,
      community: community
        ? { ...community, href: communityHref(community.handle) }
        : null,
    }
  })
}

/** An event as its page shows it. */
export type StoredEvent = Readonly<{
  id: number
  service: EventService
  ref: string
  host: string
  url: string
  name: string | null
}>

/** A public slide given as a talk of an event. */
export type EventTalk = Readonly<{
  handle: Handle
  slug: DeckSlug
  title: string | null
  /** When the slide was first published, in seconds. */
  publishedAt: number
  deploymentId: string
  coverPath: string | null
}>

const talkSchema = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  publishedAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
})

// When a deck was first published; a deck published before the column was
// added has the time its public version became ready.
const publishedAt = sql<number>`coalesce(${decks.first_published_at}, ${deployments.ready_at})`

/**
 * The decks readers may open from a list, as on the top page: a public
 * version that is ready, not taken down, by an author with a handle, and
 * not by someone the viewer muted or blocked.
 */
const publicTalks = (db: ReturnType<typeof drizzle>, viewer: string | null) =>
  db
    .select({
      eventId: relatedLinkEvents.event_id,
      deckId: decks.id,
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      publishedAt: publishedAt.as('published_at'),
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
      linkHost: relatedLinkEvents.host,
    })
    .from(relatedLinkEvents)
    .innerJoin(relatedLinks, eq(relatedLinks.id, relatedLinkEvents.link_id))
    .innerJoin(
      decks,
      and(
        eq(decks.id, relatedLinks.deck_id),
        notHidden,
        notMutedBy(viewer),
        notBlockedBy(viewer),
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

/**
 * An event and its public talks, the most recently published first; each
 * deck once, however many of its links name the event. With them, the hosts
 * the links of those talks were written with (the groups, on connpass).
 * Null when there is no such event or it has no public talk.
 */
export async function readEventPage(
  database: D1Database,
  eventId: number,
  /** Who is looking: their mutes apply. Null for a reader not signed in. */
  viewer: string | null = null,
): Promise<{
  event: StoredEvent
  talks: readonly EventTalk[]
  linkHosts: ReadonlySet<string>
} | null> {
  const db = drizzle(database)
  const [event, rows] = await Promise.all([
    db
      .select({
        id: events.id,
        service: events.service,
        ref: events.ref,
        host: events.host,
        url: events.url,
        name: events.name,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .get(),
    publicTalks(db, viewer)
      .where(eq(relatedLinkEvents.event_id, eventId))
      .orderBy(desc(publishedAt), asc(decks.slug))
      .all(),
  ])
  if (!event || rows.length === 0) return null
  // A deck with two links to the event comes twice; it is listed once.
  const decksOnce = [...new Map(rows.map((row) => [row.deckId, row])).values()]
  return {
    event,
    talks: talkSchema.array().parse(decksOnce),
    linkHosts: new Set(rows.map((row) => row.linkHost)),
  }
}

/**
 * The numbers of the events with at least one public talk, the event whose
 * first public talk is newest first (the same time, the newer event first).
 * `within` narrows them to some events, as a community's.
 */
export async function listListedEvents(
  database: D1Database,
  input: Readonly<{
    limit: number
    within?: readonly number[]
    /** Who is looking: their mutes apply. */
    viewer?: string | null
  }>,
): Promise<readonly number[]> {
  const db = drizzle(database)
  const rows = await publicTalks(db, input.viewer ?? null)
    .where(
      input.within === undefined
        ? undefined
        : inArray(relatedLinkEvents.event_id, [...input.within]),
    )
    .groupBy(relatedLinkEvents.event_id)
    .orderBy(desc(sql`min(${publishedAt})`), desc(relatedLinkEvents.event_id))
    .limit(input.limit)
    .all()
  return rows.map((row) => row.eventId)
}

/**
 * Gives an event the name an operator set, and who set it. False when there
 * is no such event.
 */
export async function renameEvent(
  database: D1Database,
  input: Readonly<{ eventId: number; name: string; by: string; now: number }>,
): Promise<boolean> {
  const result = await drizzle(database)
    .update(events)
    .set({ name: input.name, named_by: input.by, named_at: input.now })
    .where(eq(events.id, input.eventId))
    .run()
  return result.meta.changes > 0
}
