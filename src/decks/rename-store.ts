import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import type { DeckSlug } from './binding'

// This file reads the public pointer only to decide what the author may do
// with their own slide; it shows nothing to readers.

/**
 * Whether readers were ever given this slide's URL: it is public now, was
 * published once, or is stopped with a version to come back to. Such a
 * slide keeps its URL name for good.
 */
const everPublished = sql`(${decks.first_published_at} IS NOT NULL
  OR ${decks.public_deployment_id} IS NOT NULL
  OR ${decks.resume_deployment_id} IS NOT NULL)`

/** Whether the owner may still change the slide's URL name. */
export async function canRenameDeck(
  database: D1Database,
  deckId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(
        eq(decks.id, deckId),
        isNull(decks.deleted_at),
        sql`NOT ${everPublished}`,
      ),
    )
    .get()
  return row !== undefined
}

/** Whether a failed write, or what caused it, was a unique index refusing. */
function isUniqueViolation(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && depth < 5; depth++) {
    if (/UNIQUE constraint failed/i.test(String(cause))) return true
    cause = (cause as { cause?: unknown }).cause
  }
  return false
}

export type RenameResult =
  | 'renamed'
  /** Another slide of the owner has the name. */
  | 'taken'
  /** Readers were given the URL once; it stays. */
  | 'published'
  /** No such slide of this owner, or it waits to be purged. */
  | 'missing'

/**
 * Changes the URL name of the owner's slide, but only while nobody was ever
 * given its URL. One conditional update: a publication that lands while the
 * author types wins, and the unique index refuses a name another start took
 * meanwhile.
 */
export async function renameDeck(
  database: D1Database,
  input: Readonly<{ ownerUserId: string; deckId: string; slug: DeckSlug }>,
): Promise<RenameResult> {
  const db = drizzle(database)
  const { ownerUserId, deckId, slug } = input
  const mine = and(eq(decks.id, deckId), eq(decks.owner_user_id, ownerUserId))
  let changed = 0
  try {
    const result = await db
      .update(decks)
      .set({ slug })
      .where(and(mine, isNull(decks.deleted_at), sql`NOT ${everPublished}`))
      .run()
    changed = result.meta.changes
  } catch (error) {
    // The only constraint a new slug can break is the owner's unique names.
    if (!isUniqueViolation(error)) throw error
    return 'taken'
  }
  if (changed > 0) return 'renamed'
  const row = await db
    .select({ deletedAt: decks.deleted_at })
    .from(decks)
    .where(mine)
    .get()
  return row && row.deletedAt === null ? 'published' : 'missing'
}
