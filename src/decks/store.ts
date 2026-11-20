import { and, asc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import {
  deckIdSchema,
  deckSlugSchema,
  type DeckId,
  type DeckSlug,
} from './binding'

/** The names of the owner's decks that are not waiting to be purged. */
export async function listDeckSlugs(
  database: D1Database,
  ownerUserId: string,
): Promise<DeckSlug[]> {
  const rows = await drizzle(database)
    .select({ slug: decks.slug })
    .from(decks)
    .where(and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at)))
    .orderBy(asc(decks.slug))
    .all()
  return rows.map(({ slug }) => deckSlugSchema.parse(slug))
}

/**
 * Who owns a deck, for checking an upload against its owner on every
 * request. `deleted` is set while the deck waits to be purged. Null when
 * there is no such deck.
 */
export async function readDeckOwner(
  database: D1Database,
  deckId: string,
): Promise<Readonly<{
  ownerUserId: string
  slug: DeckSlug
  deleted: boolean
}> | null> {
  const row = await drizzle(database)
    .select({
      ownerUserId: decks.owner_user_id,
      slug: decks.slug,
      deletedAt: decks.deleted_at,
    })
    .from(decks)
    .where(eq(decks.id, deckId))
    .get()
  return row
    ? {
        ownerUserId: row.ownerUserId,
        slug: deckSlugSchema.parse(row.slug),
        deleted: row.deletedAt !== null,
      }
    : null
}

/**
 * The key of the owner's deck with this slug, or null. A slug is the
 * author's own name, so another author's deck of the same slug is not found
 * here, and a deck that is not there looks the same as one that is not yours.
 * `deleted` is set while the deck waits to be purged.
 */
export async function resolveDeck(
  database: D1Database,
  ownerUserId: string,
  slug: string,
): Promise<Readonly<{ id: DeckId; slug: DeckSlug; deleted: boolean }> | null> {
  const parsed = deckSlugSchema.safeParse(slug)
  if (!parsed.success) return null
  const row = await drizzle(database)
    .select({ id: decks.id, deletedAt: decks.deleted_at })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, ownerUserId), eq(decks.slug, parsed.data)),
    )
    .get()
  return row
    ? {
        id: deckIdSchema.parse(row.id),
        slug: parsed.data,
        deleted: row.deletedAt !== null,
      }
    : null
}

/**
 * Every slug the owner uses, including those of decks waiting to be purged:
 * their rows still hold the name.
 */
export async function readOwnerSlugs(
  database: D1Database,
  ownerUserId: string,
): Promise<ReadonlySet<string>> {
  const rows = await drizzle(database)
    .select({ slug: decks.slug })
    .from(decks)
    .where(eq(decks.owner_user_id, ownerUserId))
    .all()
  return new Set(rows.flatMap(({ slug }) => (slug === null ? [] : [slug])))
}

/** How many decks the owner has that are not waiting to be purged. */
export async function countLiveDecks(
  database: D1Database,
  ownerUserId: string,
): Promise<number> {
  return drizzle(database).$count(
    decks,
    and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at)),
  )
}
