/**
 * What the page of links of an address reads from D1 (F45): the event the
 * address stands for, or the links gathered by its key.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { notBlockedBy } from '../blocks/store'
import type { EventCommunityView } from '../communities/community'
import {
  findHostCommunity,
  listEventCommunities,
} from '../communities/event-communities-store'
import {
  accounts,
  communityLinks,
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
import { eventKeysOf, linkTargetOf, type LinkTarget } from './link-address'
import { pageShown, sourceOf, type NamedEvent } from './link-heading'

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

/** The deck of a related link, when readers may open it from a list. */
const openDeck = (viewer: string | null) =>
  and(
    eq(decks.id, relatedLinks.deck_id),
    notHidden,
    notMutedBy(viewer),
    notBlockedBy(viewer),
  )
const readyVersion = and(
  eq(deployments.id, decks.public_deployment_id),
  eq(deployments.deck_id, decks.id),
  eq(deployments.state, 'ready'),
)

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
    .innerJoin(decks, openDeck(viewer))
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(deployments, readyVersion)

/** What the page of the links to one address is made of. */
export type LinkPage = Readonly<{
  /** What the heading is made of; `id` is null for a link that is no event. */
  event: NamedEvent & Readonly<{ id: number | null }>
  /** Where the page leads readers. */
  source: string
  talks: readonly EventTalk[]
  linkHosts: ReadonlySet<string>
  /** The community the link is in, which heads the page (F45-AC17). */
  community: EventCommunityView | null
}>

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
): Promise<LinkPage | null> {
  const db = drizzle(database)
  const [event, links, rows, shownWith] = await Promise.all([
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
    listEventCommunities(database, [eventId]),
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
    community: shownWith.get(eventId) ?? null,
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

/**
 * The related links that are no event, on the decks readers may open, with
 * the deck of each. A link kept as an event is gathered as that event, and
 * one without a key (added before the key was kept) with no other.
 */
const gatheredLinks = (db: ReturnType<typeof drizzle>, viewer: string | null) =>
  db
    .select({
      deckId: decks.id,
      author: decks.owner_user_id,
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      publishedAt: publishedAt.as('published_at'),
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
      linkTitle: relatedLinks.title,
      href: relatedLinks.sanitized_url,
      linkHost: relatedLinks.link_host,
    })
    .from(relatedLinks)
    .leftJoin(relatedLinkEvents, eq(relatedLinkEvents.link_id, relatedLinks.id))
    .innerJoin(decks, openDeck(viewer))
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(deployments, readyVersion)

const gatheredBy = (keys: readonly string[]) =>
  and(
    inArray(relatedLinks.gather_key, [...keys]),
    isNull(relatedLinkEvents.link_id),
  )

/**
 * The page of the links gathered by the key of an address that is no event:
 * the public slides with such a link, the most recently published first.
 * Null unless the page shows (`pageShown`): an address only one author's
 * slides carry answers as one nobody added (F45-AC2), unless a community
 * holds its host (F45-AC4). The heading and the
 * way out follow the oldest link (F45-AC10, F45-AC25); the viewer's mutes
 * and blocks only leave slides out of the list (F45-AC15).
 */
async function readGatheredPage(
  database: D1Database,
  target: LinkTarget,
  viewer: string | null,
): Promise<LinkPage | null> {
  const db = drizzle(database)
  const key = target.gatherKey
  const [links, rows] = await Promise.all([
    gatheredLinks(db, null)
      .where(gatheredBy([key]))
      .orderBy(asc(relatedLinks.created_at), sql`${relatedLinks}.rowid`)
      .all(),
    gatheredLinks(db, viewer)
      .where(gatheredBy([key]))
      .orderBy(desc(publishedAt), asc(decks.slug))
      .all(),
  ])
  // Any of the links puts the page into a community (F45-AC4), by the host
  // it was written with: `www.` is another host (F30-AC65).
  const hosts = new Set(links.flatMap((link) => link.linkHost ?? []))
  const community = await findHostCommunity(database, [...hosts])
  const facts = {
    publicDecks: new Set(links.map((link) => link.deckId)).size,
    authors: new Set(links.map((link) => link.author)).size,
    kind: 'link',
    eventShaped: target.eventShaped,
    inCommunity: community !== null,
  } as const
  if (!pageShown(facts)) return null
  const decksOnce = [...new Map(rows.map((row) => [row.deckId, row])).values()]
  return {
    event: {
      id: null,
      service: 'web',
      ref: '',
      host: new URL(key).host,
      url: key,
      name: null,
      firstTitle:
        links.find((link) => link.linkTitle !== null)?.linkTitle ?? null,
    },
    source: sourceOf({ kind: 'link', firstLinkUrl: links[0]?.href ?? key }),
    talks: talkSchema.array().parse(decksOnce),
    // Only an event's group is offered a community (F45-AC27).
    linkHosts: new Set(),
    community,
  }
}

/**
 * The page of links of an address (F45-AC35): of the event kept under its
 * key, the first with a public talk; with none, of the links gathered by
 * its key. Null when neither shows.
 */
export async function readLinkPage(
  database: D1Database,
  target: LinkTarget,
  viewer: string | null,
): Promise<LinkPage | null> {
  for (const id of await findEventIdsByKey(database, eventKeysOf(target))) {
    const read = await readEventPage(database, id, viewer)
    if (read) return read
  }
  return readGatheredPage(database, target, viewer)
}

/**
 * A related link of a deck whose page of links shows, and the event it is
 * of; null for a link that is no event.
 */
export type ShownLink = Readonly<{ linkId: string; eventId: number | null }>

/**
 * The related links of a deck whose page of links shows, whoever is looking
 * (F29-AC29, F29-AC30, F45-AC18): the links to an event with a public talk,
 * this deck's or another's, and the other links whose key gathers enough
 * public slides or is in a community (`pageShown`, F45-AC4). Two queries besides the deck's own links,
 * however many links it has.
 */
export async function listShownLinks(
  database: D1Database,
  deckId: string,
): Promise<readonly ShownLink[]> {
  const db = drizzle(database)
  const own = await db
    .select({
      linkId: relatedLinks.id,
      eventId: relatedLinkEvents.event_id,
      key: relatedLinks.gather_key,
    })
    .from(relatedLinks)
    .leftJoin(relatedLinkEvents, eq(relatedLinkEvents.link_id, relatedLinks.id))
    .where(eq(relatedLinks.deck_id, deckId))
    .all()
  const eventIds = own.map((link) => link.eventId).filter((id) => id !== null)
  // A key the path of a page does not lead back to has no page to show.
  const targets = new Map(
    own
      .filter((link) => link.eventId === null && link.key !== null)
      .map((link) => [link.key ?? '', linkTargetOf(link.key ?? '')] as const)
      .filter(([key, target]) => target.gatherKey === key),
  )
  const [talks, gathered] = await Promise.all([
    eventIds.length === 0
      ? []
      : publicTalks(db, null)
          .where(inArray(relatedLinkEvents.event_id, [...new Set(eventIds)]))
          .groupBy(relatedLinkEvents.event_id)
          .all(),
    targets.size === 0
      ? []
      : db
          .select({
            key: relatedLinks.gather_key,
            publicDecks: sql<number>`count(DISTINCT ${decks.id})`,
            authors: sql<number>`count(DISTINCT ${decks.owner_user_id})`,
            // Whether a community holds the host of any of them (F45-AC4).
            held: sql<number>`max(EXISTS (SELECT 1 FROM ${communityLinks}
              WHERE ${communityLinks.host} = ${relatedLinks.link_host}))`,
          })
          .from(relatedLinks)
          .leftJoin(
            relatedLinkEvents,
            eq(relatedLinkEvents.link_id, relatedLinks.id),
          )
          .innerJoin(decks, openDeck(null))
          .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
          .innerJoin(deployments, readyVersion)
          .where(gatheredBy([...targets.keys()]))
          .groupBy(relatedLinks.gather_key)
          .all(),
  ])
  const events = new Set(talks.map((row) => row.eventId))
  const keys = new Set(
    gathered
      .filter((row) =>
        pageShown({
          ...row,
          kind: 'link',
          eventShaped: targets.get(row.key ?? '')?.eventShaped ?? false,
          inCommunity: row.held === 1,
        }),
      )
      .map((row) => row.key),
  )
  return own
    .filter((link) =>
      link.eventId === null ? keys.has(link.key) : events.has(link.eventId),
    )
    .map(({ linkId, eventId }) => ({ linkId, eventId }))
}
