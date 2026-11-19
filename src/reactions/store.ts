import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { reactionPostRowSchema, reactionPosts } from '../db/schema'
import type { DeckId } from '../decks/binding'
import { postKey, postOfKey, type Post } from './post'

/** How many posts one deck shows. */
export const MAX_POSTS = 200

/** A post shown under a deck; page 0 is the whole deck. */
export type StoredPost = Readonly<{
  id: string
  page: number
  post: Post
  source: 'pasted' | 'collected'
  postedAt: number | null
  addedAt: number
}>

/**
 * The posts shown under a deck, oldest first where the time is known. Rows
 * that no longer read as a post are skipped, not shown.
 */
export async function listPosts(
  database: D1Database,
  deckId: DeckId,
): Promise<StoredPost[]> {
  const rows = await drizzle(database)
    .select()
    .from(reactionPosts)
    .where(eq(reactionPosts.deck_id, deckId))
    .orderBy(
      asc(reactionPosts.page),
      sql`${reactionPosts.posted_at} IS NULL`,
      asc(reactionPosts.posted_at),
      asc(reactionPosts.created_at),
      reactionPosts.id,
    )
    .limit(MAX_POSTS)
  return reactionPostRowSchema
    .array()
    .parse(rows)
    .flatMap((row) => {
      const post = postOfKey(row.service, row.post_key)
      return post
        ? [
            {
              id: row.id,
              page: row.page,
              post,
              source: row.source,
              postedAt: row.posted_at,
              addedAt: row.created_at,
            },
          ]
        : []
    })
}

/**
 * Adds posts under a deck. Tells how many were added, and how many new ones
 * found no room. A post already shown keeps its page and source. The room is
 * read before the write, so two additions at once may pass the limit by one
 * addition's posts; only the deck's owner adds, so the trial accepts that.
 */
export async function addPosts(
  database: D1Database,
  deckId: DeckId,
  posts: readonly Readonly<{
    post: Post
    page: number
    source: 'pasted' | 'collected'
    postedAt: number | null
  }>[],
  now: number,
): Promise<{ added: number; refused: number }> {
  const db = drizzle(database)
  const shown = await db
    .select({ service: reactionPosts.service, key: reactionPosts.post_key })
    .from(reactionPosts)
    .where(eq(reactionPosts.deck_id, deckId))
  const known = new Set(shown.map((row) => `${row.service} ${row.key}`))
  const fresh = posts.filter(
    (item) => !known.has(`${item.post.service} ${postKey(item.post)}`),
  )
  const taken = fresh.slice(0, Math.max(0, MAX_POSTS - shown.length))
  const [first, ...rest] = taken.map((item) =>
    db
      .insert(reactionPosts)
      .values({
        id: crypto.randomUUID(),
        deck_id: deckId,
        page: item.page,
        service: item.post.service,
        post_key: postKey(item.post),
        source: item.source,
        posted_at: item.postedAt,
        created_at: now,
      })
      .onConflictDoNothing(),
  )
  const results = first ? await db.batch([first, ...rest]) : []
  return {
    added: results.reduce((sum, result) => sum + result.meta.changes, 0),
    refused: fresh.length - taken.length,
  }
}

/** Removes one post from under a deck. */
export async function removePost(
  database: D1Database,
  deckId: DeckId,
  id: string,
) {
  await drizzle(database)
    .delete(reactionPosts)
    .where(and(eq(reactionPosts.deck_id, deckId), eq(reactionPosts.id, id)))
}
