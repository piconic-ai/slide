import { and, asc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, relatedLinkEvents, relatedLinks } from '../db/schema'
import type { EventRef } from '../events/event-url'
import { MAX_LINKS, type LinkInput, type LinkKind } from './link'

export type StoredLink = Readonly<
  {
    id: string
    url: string
    /** Null when none was typed: the link shows its site name. */
    title: string | null
  } & (
    | { kind: Exclude<LinkKind, 'event'> }
    /** A talk of the event with this number. */
    | { kind: 'event'; eventId: number }
  )
>

/** A link's kind and what goes with it, as a change of kind is given. */
export type LinkKinding =
  | Readonly<{ kind: Exclude<LinkKind, 'event'> }>
  | Readonly<{ kind: 'event'; event: EventRef }>

/**
 * related_links.kind keeps its CHECK of three kinds, so a link of the kind
 * "event" is written 'other' there and has a row in related_link_events.
 */
const storedKind = (kind: LinkKind) => (kind === 'event' ? 'other' : kind)

/** A deck's links in the order they were added. */
export async function listLinks(
  database: D1Database,
  deckId: string,
): Promise<readonly StoredLink[]> {
  const rows = await drizzle(database)
    .select({
      id: relatedLinks.id,
      kind: relatedLinks.kind,
      url: relatedLinks.url,
      title: relatedLinks.title,
      eventId: relatedLinkEvents.event_id,
    })
    .from(relatedLinks)
    .leftJoin(relatedLinkEvents, eq(relatedLinkEvents.link_id, relatedLinks.id))
    .where(eq(relatedLinks.deck_id, deckId))
    .orderBy(asc(relatedLinks.position))
    .all()
  return rows.map(({ eventId, kind, ...link }) =>
    eventId === null
      ? { ...link, kind }
      : { ...link, kind: 'event' as const, eventId },
  )
}

/** The decks of an owner that still exist. */
const liveDeckOf = (ownerUserId: string) =>
  and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at))

// Whether the link ?1 is on the deck ?2 of the owner ?3, which still exists.
const OWNED_LINK = `EXISTS (
  SELECT 1 FROM related_links JOIN decks ON decks.id = related_links.deck_id
  WHERE related_links.id = ?1 AND related_links.deck_id = ?2
    AND decks.owner_user_id = ?3 AND decks.deleted_at IS NULL)`
// Whether the link ?1 is in.
const LINK_IN = 'EXISTS (SELECT 1 FROM related_links WHERE id = ?1)'

/**
 * The statements that make the link ?1 a talk of its event, each run only
 * when `guard` holds (its parameters come first, in the same numbers): the
 * event is made when it is new, it takes the link's title as its name while
 * it has none (the first title saved), and the link is tied to it.
 */
function tieToEvent(
  database: D1Database,
  input: Readonly<{
    guard: string
    params: readonly unknown[]
    event: EventRef
    now: number
  }>,
): D1PreparedStatement[] {
  const { guard, params, event, now } = input
  // The event's fields follow the guard's parameters.
  const at = (index: number) => `?${params.length + index}`
  const values = [
    ...params,
    event.key,
    event.service,
    event.ref,
    event.host,
    event.url,
    now,
  ]
  const title = '(SELECT title FROM related_links WHERE id = ?1)'
  return [
    database
      .prepare(
        `INSERT INTO events (key, service, ref, host, url, created_at)
        SELECT ${at(1)}, ${at(2)}, ${at(3)}, ${at(4)}, ${at(5)}, ${at(6)}
        WHERE ${guard}
        ON CONFLICT (key) DO NOTHING`,
      )
      .bind(...values),
    database
      .prepare(
        `UPDATE events SET name = ${title}
        WHERE key = ${at(1)} AND name IS NULL AND ${title} IS NOT NULL AND ${guard}`,
      )
      .bind(...params, event.key),
    database
      .prepare(
        `INSERT INTO related_link_events (link_id, event_id, created_at)
        SELECT ?1, id, ${at(2)} FROM events WHERE key = ${at(1)} AND ${guard}`,
      )
      .bind(...params, event.key, now),
  ]
}

export type AddResult = 'added' | 'full' | 'missing'

/**
 * Adds a link to the owner's deck, last in order. One statement checks the
 * owner, the deck and the limit, so two adds at once cannot pass the limit.
 * A foreign, deleted or unknown deck is 'missing' alike. A link of the kind
 * "event" is tied to its event in the same batch, and only once it is in.
 */
export async function addLink(
  database: D1Database,
  input: Readonly<{
    deckId: string
    ownerUserId: string
    link: LinkInput
    now: number
  }>,
): Promise<AddResult> {
  const { deckId, ownerUserId, link, now } = input
  const linkId = crypto.randomUUID()
  const insert = database
    .prepare(
      `INSERT INTO related_links (id, deck_id, kind, url, title, position, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5,
        (SELECT coalesce(max(position), 0) + 1 FROM related_links WHERE deck_id = ?2),
        ?6
      WHERE EXISTS (
        SELECT 1 FROM decks
        WHERE id = ?2 AND owner_user_id = ?7 AND deleted_at IS NULL)
      AND (SELECT count(*) FROM related_links WHERE deck_id = ?2) < ?8`,
    )
    .bind(
      linkId,
      deckId,
      storedKind(link.kind),
      link.url,
      link.title,
      now,
      ownerUserId,
      MAX_LINKS,
    )
  const [result] = await database.batch([
    insert,
    ...(link.kind === 'event'
      ? tieToEvent(database, {
          guard: LINK_IN,
          params: [linkId],
          event: link.event,
          now,
        })
      : []),
  ])
  if (!result) throw new Error('The link was not inserted')
  if (result.meta.changes > 0) return 'added'
  const deck = await drizzle(database)
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), liveDeckOf(ownerUserId)))
    .get()
  return deck ? 'full' : 'missing'
}

/**
 * Changes the kind of one link of the owner's deck. The link leaves the event
 * it was in, and joins the event its address stands for when it becomes an
 * event, in one batch. Anything else is 'missing'.
 */
export async function setLinkKind(
  database: D1Database,
  input: Readonly<{
    deckId: string
    ownerUserId: string
    linkId: string
    kinding: LinkKinding
    now: number
  }>,
): Promise<'changed' | 'missing'> {
  const { linkId, kinding, now } = input
  const params = [linkId, input.deckId, input.ownerUserId]
  const [, update] = await database.batch([
    database
      .prepare(
        `DELETE FROM related_link_events WHERE link_id = ?1 AND ${OWNED_LINK}`,
      )
      .bind(...params),
    database
      .prepare(
        `UPDATE related_links SET kind = ?4 WHERE id = ?1 AND ${OWNED_LINK}`,
      )
      .bind(...params, storedKind(kinding.kind)),
    ...(kinding.kind === 'event'
      ? tieToEvent(database, {
          guard: OWNED_LINK,
          params,
          event: kinding.event,
          now,
        })
      : []),
  ])
  if (!update) throw new Error('The kind was not updated')
  return update.meta.changes > 0 ? 'changed' : 'missing'
}

/** Removes one link of the owner's deck, and its tie to an event. Anything else is 'missing'. */
export async function removeLink(
  database: D1Database,
  input: Readonly<{ deckId: string; ownerUserId: string; linkId: string }>,
): Promise<'removed' | 'missing'> {
  const params = [input.linkId, input.deckId, input.ownerUserId]
  const [, result] = await database.batch([
    database
      .prepare(
        `DELETE FROM related_link_events WHERE link_id = ?1 AND ${OWNED_LINK}`,
      )
      .bind(...params),
    database
      .prepare(`DELETE FROM related_links WHERE id = ?1 AND ${OWNED_LINK}`)
      .bind(...params),
  ])
  if (!result) throw new Error('The link was not removed')
  return result.meta.changes > 0 ? 'removed' : 'missing'
}
