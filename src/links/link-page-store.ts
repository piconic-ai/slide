/**
 * What the page of links of an address reads from D1 (F45). For now only
 * the event an address stands for; the other links come with their columns.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { notBlockedBy } from '../blocks/store'
import {
  accounts,
  decks,
  deployments,
  events,
  lumaEventAliases,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { deckSlugSchema, type DeckSlug } from '../decks/deck-id'
import { notMutedBy } from '../mutes/store'
import { notHidden, notHiddenOf } from '../publication/takedown-store'
import { handleSchema, type Handle } from '../share/handle'
import { sourceOf, type NamedEvent } from './link-heading'

/**
 * The events kept under the keys, in the order of the keys. The keys are
 * the ways one address may have been kept (`eventKeysOf`).
 */
export async function findEventIdsByKey(
  database: D1Database,
  keys: readonly string[],
): Promise<readonly number[]> {
  if (keys.length === 0) return []
  const rows = await drizzle(database)
    .select({ id: events.id, key: events.key })
    .from(events)
    .where(inArray(events.key, [...keys]))
    .all()
  const byKey = new Map(rows.map((row) => [row.key, row.id]))
  return keys.map((key) => byKey.get(key)).filter((id) => id !== undefined)
}

/**
 * The key of the name a calendar's feed paired with a Luma id key
 * (F33-AC20), or null when no feed told it.
 */
export async function findAliasedKey(
  database: D1Database,
  key: string,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ key: lumaEventAliases.event_key })
    .from(lumaEventAliases)
    .where(eq(lumaEventAliases.alias_key, key))
    .get()
  return row?.key ?? null
}

/** An event as its page shows it. */
export type StoredEvent = NamedEvent & Readonly<{ id: number }>

const titled = alias(decks, 'titled_deck')

/**
 * For a row of `events` in a list: the title of the oldest titled link to
 * it on a slide anyone may open (F45-AC10), as `readEventPage` picks it for
 * the page. Names `events` itself, so it reads right under any join.
 */
export const firstPublicTitle = sql<string | null>`(
  SELECT l.title FROM related_link_events AS le
  JOIN related_links AS l ON l.id = le.link_id
  JOIN decks AS titled_deck ON titled_deck.id = l.deck_id
  JOIN accounts AS a ON a.user_id = titled_deck.owner_user_id
  JOIN deployments AS p ON p.id = titled_deck.public_deployment_id
    AND p.deck_id = titled_deck.id AND p.state = 'ready'
  WHERE le.event_id = "events"."id" AND l.title IS NOT NULL
    AND ${notHiddenOf(titled)}
  ORDER BY le.created_at, le.rowid LIMIT 1)`

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
 * version that is ready, not taken down, by an author with a handle
 * (F45-AC14), and not by someone the viewer muted or blocked. With no
 * viewer they are the decks anyone may open.
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
      linkTitle: relatedLinks.title,
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

const ofEvent = (eventId: number) => eq(relatedLinkEvents.event_id, eventId)

/**
 * An event and its public talks, the most recently published first; each
 * deck once, however many of its links name the event. With them, the hosts
 * the links of its public talks were written with (the groups, on connpass).
 * Its first title and where it leads (`source`) follow the oldest of those
 * links (F45-AC10, F45-AC25).
 * Null when there is no such event or it has no public talk: that is the
 * same for everyone. The viewer's mutes and blocks only leave talks out of
 * the list, down to none (F45-AC15).
 */
export async function readEventPage(
  database: D1Database,
  eventId: number,
  /** Who is looking. Null for a reader not signed in. */
  viewer: string | null = null,
): Promise<{
  event: StoredEvent
  /** Where the page leads readers. */
  source: string
  talks: readonly EventTalk[]
  linkHosts: ReadonlySet<string>
} | null> {
  const db = drizzle(database)
  const [event, links, rows] = await Promise.all([
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
    // The links to the event on public decks, the oldest first, whoever is
    // looking: drafts stay their author's, and mutes and blocks move neither
    // whether the page shows, nor its heading, nor where it leads.
    publicTalks(db, null)
      .where(ofEvent(eventId))
      .orderBy(
        asc(relatedLinkEvents.created_at),
        sql`${relatedLinkEvents}.rowid`,
      )
      .all(),
    publicTalks(db, viewer)
      .where(ofEvent(eventId))
      .orderBy(desc(publishedAt), asc(decks.slug))
      .all(),
  ])
  if (!event || links.length === 0) return null
  // A deck with two links to the event comes twice; it is listed once.
  const decksOnce = [...new Map(rows.map((row) => [row.deckId, row])).values()]
  const firstTitle =
    links.find((link) => link.linkTitle !== null)?.linkTitle ?? null
  return {
    event: { ...event, firstTitle },
    source: sourceOf({
      kind: 'event',
      event,
      firstLinkHost: links[0]?.linkHost ?? null,
    }),
    talks: talkSchema.array().parse(decksOnce),
    linkHosts: new Set(links.map((row) => row.linkHost)),
  }
}

/**
 * The address of an event with a public talk, whoever is looking; null for
 * no such event and for one without a public talk (F45-AC9).
 */
export async function findShownEventUrl(
  database: D1Database,
  eventId: number,
): Promise<string | null> {
  const db = drizzle(database)
  const [event, talk] = await Promise.all([
    db
      .select({ url: events.url })
      .from(events)
      .where(eq(events.id, eventId))
      .get(),
    publicTalks(db, null).where(ofEvent(eventId)).limit(1).get(),
  ])
  return event && talk ? event.url : null
}

/** A related link of a deck whose page of links shows, and the event it is of. */
export type ShownLink = Readonly<{ linkId: string; eventId: number }>

/**
 * The related links of a deck whose page of links shows, whoever is looking
 * (F29-AC29, F29-AC30): for now the links to an event with a public talk,
 * this deck's or another's. The other links come with their columns.
 */
export async function listShownLinks(
  database: D1Database,
  deckId: string,
): Promise<readonly ShownLink[]> {
  const db = drizzle(database)
  const own = await db
    .select({ linkId: relatedLinks.id, eventId: relatedLinkEvents.event_id })
    .from(relatedLinks)
    .innerJoin(
      relatedLinkEvents,
      eq(relatedLinkEvents.link_id, relatedLinks.id),
    )
    .where(eq(relatedLinks.deck_id, deckId))
    .all()
  if (own.length === 0) return []
  const shown = await publicTalks(db, null)
    .where(
      inArray(relatedLinkEvents.event_id, [
        ...new Set(own.map((link) => link.eventId)),
      ]),
    )
    .groupBy(relatedLinkEvents.event_id)
    .all()
  const events = new Set(shown.map((row) => row.eventId))
  return own.filter((link) => events.has(link.eventId))
}
