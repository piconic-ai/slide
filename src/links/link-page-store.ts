/**
 * What the page of links of an address reads from D1 (F45): the event the
 * address stands for, or the links gathered by its key.
 */
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'
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
import {
  eventKeysOf,
  eventPagePath,
  linkTargetOf,
  type LinkTarget,
} from './link-address'
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

/**
 * For a row of `related_links` that is no event, in a list: the title of
 * the oldest titled link with its key on a slide anyone may open, as
 * `readGatheredPage` picks it for the page (F45-AC10).
 */
export const firstGatheredTitle = sql<string | null>`(
  SELECT l.title FROM related_links AS l
  JOIN decks AS titled_deck ON titled_deck.id = l.deck_id
  JOIN accounts AS a ON a.user_id = titled_deck.owner_user_id
  JOIN deployments AS p ON p.id = titled_deck.public_deployment_id
    AND p.deck_id = titled_deck.id AND p.state = 'ready'
  WHERE l.gather_key = "related_links"."gather_key" AND l.title IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM related_link_events AS le
      WHERE le.link_id = l.id)
    AND ${notHiddenOf(titled)}
  ORDER BY l.created_at, l.rowid LIMIT 1)`

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
      gatherKey: relatedLinks.gather_key,
    })
    .from(relatedLinkEvents)
    .innerJoin(relatedLinks, eq(relatedLinks.id, relatedLinkEvents.link_id))
    .innerJoin(decks, openDeck(viewer))
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(deployments, readyVersion)

/** The order of a list of slides: the most recently published first. */
const newestFirst = (
  a: Readonly<{ publishedAt: number; slug: string }>,
  b: Readonly<{ publishedAt: number; slug: string }>,
) => b.publishedAt - a.publishedAt || (a.slug < b.slug ? -1 : 1)

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
 * links (F45-AC10, F45-AC42).
 * Null when there is no such event or it has no public talk: that is the
 * same for everyone. The viewer's mutes and blocks only leave talks out of
 * the list, down to none (F45-AC15).
 * The public slides that carry the same address under another kind are
 * listed with them, each slide once (F45-AC38): the links that are no event
 * and have the gathered key of a link to the event on a public slide.
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
  // The keys of the event's public links come from a subquery, not as bound
  // values: an event whose links were written with many queries has more keys
  // than D1 binds in one statement.
  const eventKeys = publicTalks(db, null).where(ofEvent(eventId)).as('keys')
  const others = !links.some((link) => link.gatherKey !== null)
    ? []
    : await gatheredLinks(db, viewer)
        .where(
          and(
            inArray(
              relatedLinks.gather_key,
              db
                .select({ key: eventKeys.gatherKey })
                .from(eventKeys)
                .where(isNotNull(eventKeys.gatherKey)),
            ),
            isNull(relatedLinkEvents.link_id),
          ),
        )
        .all()
  // A deck with two links to the event, or with one of each kind, comes
  // twice; it is listed once.
  const decksOnce = [
    ...new Map([...rows, ...others].map((row) => [row.deckId, row])).values(),
  ]
  const firstTitle =
    links.find((link) => link.linkTitle !== null)?.linkTitle ?? null
  return {
    event: { ...event, firstTitle },
    source: sourceOf({
      kind: 'event',
      event,
      firstLinkHost: links[0]?.linkHost ?? null,
    }),
    talks: talkSchema.array().parse(decksOnce).sort(newestFirst),
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
 * way out follow the oldest link (F45-AC10, F45-AC42); the viewer's mutes
 * and blocks only leave slides out of the list (F45-AC15).
 */
export async function readGatheredPage(
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
 * The page of the event kept under the key of an address (F45-AC35), or
 * null when there is none or it has no public talk.
 */
export async function readEventPageOf(
  database: D1Database,
  target: LinkTarget,
  viewer: string | null,
): Promise<LinkPage | null> {
  for (const id of await findEventIdsByKey(database, eventKeysOf(target))) {
    const read = await readEventPage(database, id, viewer)
    if (read) return read
  }
  return null
}

/**
 * A related link of a deck whose page of links shows: the event it is of
 * (null for a link that is no event) and the path of the page its slide is
 * listed on. A link that is no event names the community it is in by the host
 * it was written with (F29-AC29), the one whose link was added first; an
 * event's community comes with the event.
 */
export type ShownLink = Readonly<{
  linkId: string
  eventId: number | null
  path: string
  community: string | null
}>

/** For a row of `related_links`: the name of the community holding its host. */
const hostCommunityName = sql<string | null>`(
  SELECT c.name FROM community_links AS cl
  JOIN communities AS c ON c.id = cl.community_id
  WHERE cl.host = ${relatedLinks.link_host} ORDER BY cl.id LIMIT 1)`

/** What is known of the public slides that carry one gathered key. */
type KeyRow = Readonly<{
  key: string | null
  /** The event the links of this row are tied to; null for links of none. */
  eventId: number | null
  eventUrl: string | null
  publicDecks: number
  authors: number
  /** 1 when a community holds the host of any of the links (F45-AC4). */
  held: number
}>

/**
 * The path of the page a link that is no event is listed on, by its
 * gathered key: the page of the event that has a link with the same key on
 * a public slide, which lists it too (F45-AC38; the oldest event when there
 * are two), or else the page of the key itself while enough slides carry it
 * or a community holds it (`pageShown`, F45-AC4). Null when its slide is on
 * no page.
 */
function pathOfKey(key: string, rows: readonly KeyRow[]): string | null {
  const [event] = rows
    .filter((row) => row.eventId !== null && row.eventUrl !== null)
    .sort((a, b) => (a.eventId ?? 0) - (b.eventId ?? 0))
  if (event?.eventUrl) return eventPagePath(event.eventUrl)
  const target = linkTargetOf(key)
  const gathered = rows.find((row) => row.eventId === null)
  // A key the path of a page does not lead back to has no page to show.
  if (!gathered || target.gatherKey !== key) return null
  const shown = pageShown({
    publicDecks: gathered.publicDecks,
    authors: gathered.authors,
    kind: 'link',
    eventShaped: target.eventShaped,
    inCommunity: gathered.held === 1,
  })
  return shown ? `/link/${target.rest}` : null
}

/**
 * The related links of a deck whose page of links shows, whoever is looking
 * (F29-AC29, F29-AC30, F45-AC18), each with the path of the page its slide
 * is listed on: the links to an event with a public talk, this deck's or
 * another's, and the other links, on the page of the event with the same
 * address or on the page of their key (`pathOfKey`). Two queries besides
 * the deck's own links, however many links it has.
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
      community: hostCommunityName,
    })
    .from(relatedLinks)
    .leftJoin(relatedLinkEvents, eq(relatedLinkEvents.link_id, relatedLinks.id))
    .where(eq(relatedLinks.deck_id, deckId))
    .all()
  const eventIds = own.map((link) => link.eventId).filter((id) => id !== null)
  const keys = new Set(
    own
      .filter((link) => link.eventId === null)
      .map((link) => link.key)
      .filter((key) => key !== null),
  )
  const [talks, carried] = await Promise.all([
    eventIds.length === 0
      ? []
      : db
          .select({ eventId: events.id, url: events.url })
          .from(relatedLinkEvents)
          .innerJoin(events, eq(events.id, relatedLinkEvents.event_id))
          .innerJoin(
            relatedLinks,
            eq(relatedLinks.id, relatedLinkEvents.link_id),
          )
          .innerJoin(decks, openDeck(null))
          .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
          .innerJoin(deployments, readyVersion)
          .where(inArray(relatedLinkEvents.event_id, [...new Set(eventIds)]))
          .groupBy(events.id)
          .all(),
    // The public slides that carry the keys: for each key, those tied to an
    // event (one row an event) and those of no event (one row).
    keys.size === 0
      ? []
      : db
          .select({
            key: relatedLinks.gather_key,
            eventId: relatedLinkEvents.event_id,
            eventUrl: events.url,
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
          .leftJoin(events, eq(events.id, relatedLinkEvents.event_id))
          .innerJoin(decks, openDeck(null))
          .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
          .innerJoin(deployments, readyVersion)
          .where(inArray(relatedLinks.gather_key, [...keys]))
          .groupBy(relatedLinks.gather_key, relatedLinkEvents.event_id)
          .all(),
  ])
  const pathOfEvent = new Map(
    talks.map((row) => [row.eventId, eventPagePath(row.url)]),
  )
  const pathsOfKeys = new Map(
    [...keys].map((key) => [
      key,
      pathOfKey(
        key,
        carried.filter((row) => row.key === key),
      ),
    ]),
  )
  return own.flatMap(({ linkId, eventId, key, community }) => {
    const path =
      eventId === null ? pathsOfKeys.get(key ?? '') : pathOfEvent.get(eventId)
    return path
      ? [
          {
            linkId,
            eventId,
            path,
            community: eventId === null ? community : null,
          },
        ]
      : []
  })
}
