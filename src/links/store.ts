import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, relatedLinks } from '../db/schema'
import { MAX_LINKS, type LinkInput, type LinkKind } from './link'
import { normalizedUrlOf } from './normalize'
import { sanitizedUrlOf } from './sanitize'

export type StoredLink = Readonly<{
  id: string
  kind: LinkKind
  /** The address as the author added it: a record, never shown on a page. */
  url: string
  /** The sanitized address the link leads to and is shown as. */
  href: string
  /** Null when none was typed: the link shows its site name. */
  title: string | null
}>

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
      sanitized: relatedLinks.sanitized_url,
      title: relatedLinks.title,
    })
    .from(relatedLinks)
    .where(eq(relatedLinks.deck_id, deckId))
    .orderBy(asc(relatedLinks.position))
    .all()
  return rows.map(({ sanitized, ...link }) => ({
    ...link,
    href: sanitized ?? hrefOfUnsanitized(link.url),
  }))
}

/**
 * The address of a row the Worker before migration 0052 added, which has no
 * sanitized one. A stored url the parser cannot read is left as it is, as
 * before, rather than failing the whole page.
 */
function hrefOfUnsanitized(url: string): string {
  try {
    return sanitizedUrlOf(url)
  } catch {
    return url
  }
}

/** The decks of an owner that still exist. */
const liveDeckOf = (ownerUserId: string) =>
  and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at))

export type AddResult = 'added' | 'duplicate' | 'full' | 'missing'

/**
 * Adds a link to the owner's deck, last in order. One statement checks the
 * owner, the deck, that the deck has no link of the same compared form and
 * the limit, so two adds at once cannot pass the limit nor keep one address
 * twice. A foreign, deleted or unknown deck is 'missing' alike, whatever it
 * holds. A link the deck has already is 'duplicate' even at the limit
 * (F27-AC49): that is what the author needs to know.
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
  const db = drizzle(database)
  const normalized = normalizedUrlOf(link.url)
  const result = await db.run(sql`
    INSERT INTO related_links (id, deck_id, kind, url, normalized_url, sanitized_url, title, position, created_at)
    SELECT ${crypto.randomUUID()}, ${deckId}, ${link.kind}, ${link.url}, ${normalized}, ${sanitizedUrlOf(link.url)}, ${link.title},
      (SELECT coalesce(max(position), 0) + 1 FROM related_links WHERE deck_id = ${deckId}),
      ${now}
    WHERE EXISTS (
      SELECT 1 FROM decks
      WHERE id = ${deckId} AND owner_user_id = ${ownerUserId} AND deleted_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM related_links WHERE deck_id = ${deckId} AND normalized_url = ${normalized})
    AND (SELECT count(*) FROM related_links WHERE deck_id = ${deckId}) < ${MAX_LINKS}`)
  if (result.meta.changes > 0) return 'added'
  const deck = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), liveDeckOf(ownerUserId)))
    .get()
  if (!deck) return 'missing'
  const same = await db
    .select({ id: relatedLinks.id })
    .from(relatedLinks)
    .where(
      and(
        eq(relatedLinks.deck_id, deckId),
        eq(relatedLinks.normalized_url, normalized),
      ),
    )
    .get()
  return same ? 'duplicate' : 'full'
}

/** Removes one link of the owner's deck. Anything else is 'missing'. */
export async function removeLink(
  database: D1Database,
  input: Readonly<{ deckId: string; ownerUserId: string; linkId: string }>,
): Promise<'removed' | 'missing'> {
  const { deckId, ownerUserId, linkId } = input
  const db = drizzle(database)
  const result = await db
    .delete(relatedLinks)
    .where(
      and(
        eq(relatedLinks.id, linkId),
        eq(relatedLinks.deck_id, deckId),
        inArray(
          relatedLinks.deck_id,
          db
            .select({ id: decks.id })
            .from(decks)
            .where(and(eq(decks.id, deckId), liveDeckOf(ownerUserId))),
        ),
      ),
    )
    .run()
  return result.meta.changes > 0 ? 'removed' : 'missing'
}
