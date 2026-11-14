import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  isNull,
  like,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  citations,
  decks,
  deployments,
  reactionPostRowSchema,
  reactionPosts,
  uploadFiles,
} from '../db/schema'
import type { Citation } from './citation'
import { postKey, postOfKey, postUrl, type Post } from './post'

/** How many HTML files of one deployment are read for links. */
export const MAX_SCANNED_FILES = 200

/** How many posts one deck shows. */
export const MAX_POSTS = 200

/** The stored HTML files of a deployment, entry first. */
export async function listHtmlObjects(
  database: D1Database,
  deploymentId: string,
): Promise<string[]> {
  const rows = await drizzle(database)
    .select({ key: uploadFiles.object_key })
    .from(uploadFiles)
    .where(
      and(
        eq(uploadFiles.deployment_id, deploymentId),
        like(uploadFiles.media_type, 'text/html%'),
      ),
    )
    .orderBy(sql`${uploadFiles.path} = 'index.html' DESC`, uploadFiles.path)
    .limit(MAX_SCANNED_FILES)
  return rows.flatMap((row) => (row.key ? [row.key] : []))
}

/** The share URL names of a deployment's own deck, where it has them. */
export async function readDeploymentDeck(
  database: D1Database,
  deploymentId: string,
): Promise<{ handle: string | null; slug: string | null }> {
  const row = await drizzle(database)
    .select({ handle: accounts.handle, slug: deployments.deck_id })
    .from(deployments)
    .leftJoin(decks, eq(decks.id, deployments.deck_id))
    .leftJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(eq(deployments.id, deploymentId))
    .get()
  return { handle: row?.handle ?? null, slug: row?.slug ?? null }
}

/** Keeps a deployment's citations; saving the same ones again changes nothing. */
export async function saveCitations(
  database: D1Database,
  deploymentId: string,
  found: readonly Citation[],
) {
  const db = drizzle(database)
  const [first, ...rest] = found.map((citation) =>
    db
      .insert(citations)
      .values({
        deployment_id: deploymentId,
        target_handle: citation.handle,
        target_slug: citation.slug,
        target_page: citation.page,
      })
      .onConflictDoNothing(),
  )
  if (first) await db.batch([first, ...rest])
}

const citedDeckSchema = z.object({
  handle: z.string(),
  slug: z.string(),
  title: z.string().nullable(),
  deploymentId: z.string(),
  /** When the deployment readers see became ready. */
  at: z.number().int(),
})
/** A public deck on one side of a citation, and the deployment readers see. */
export type CitedDeck = Readonly<z.infer<typeof citedDeckSchema>>

/**
 * The public decks whose current public deployment links to the given deck,
 * each once however many of its pages are linked, the most recently
 * published first, and how many there are in all. A deck stops counting when
 * its author unpublishes it or publishes a version without the link.
 */
export async function readCitedBy(
  database: D1Database,
  handle: string,
  slug: string,
  limit: number,
): Promise<{ decks: CitedDeck[]; total: number }> {
  const db = drizzle(database)
  const citing = (fields: Parameters<typeof db.selectDistinct>[0]) =>
    db
      .selectDistinct(fields)
      .from(citations)
      .innerJoin(decks, eq(decks.public_deployment_id, citations.deployment_id))
      .innerJoin(
        deployments,
        and(
          eq(deployments.id, citations.deployment_id),
          eq(deployments.deck_id, decks.id),
          eq(deployments.state, 'ready'),
        ),
      )
      .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
      .where(
        and(
          eq(citations.target_handle, handle),
          eq(citations.target_slug, slug),
          isNull(decks.deleted_at),
        ),
      )
  const [rows, counted] = await Promise.all([
    citing({
      handle: accounts.handle,
      slug: decks.id,
      title: deployments.title,
      deploymentId: deployments.id,
      at: deployments.ready_at,
    })
      .orderBy(desc(deployments.ready_at), accounts.handle, decks.id)
      .limit(limit),
    citing({ total: countDistinct(decks.id) }),
  ])
  return {
    decks: citedDeckSchema.array().parse(rows),
    total: z.object({ total: z.number().int() }).parse(counted[0]).total,
  }
}

/**
 * The decks a deployment links to that are public now, each once however
 * many of its pages are linked, the most recently published first. Links to
 * drafts, paused or unknown decks are left out, so the list never tells that such a deck exists.
 */
export async function readCites(
  database: D1Database,
  deploymentId: string,
): Promise<CitedDeck[]> {
  const target = alias(deployments, 'target')
  const rows = await drizzle(database)
    .selectDistinct({
      handle: citations.target_handle,
      slug: citations.target_slug,
      title: target.title,
      deploymentId: target.id,
      at: target.ready_at,
    })
    .from(citations)
    .innerJoin(accounts, eq(accounts.handle, citations.target_handle))
    .innerJoin(
      decks,
      and(
        eq(decks.owner_user_id, accounts.user_id),
        eq(decks.id, citations.target_slug),
      ),
    )
    .innerJoin(
      target,
      and(
        eq(target.id, decks.public_deployment_id),
        eq(target.deck_id, decks.id),
        eq(target.state, 'ready'),
      ),
    )
    .where(eq(citations.deployment_id, deploymentId))
    .orderBy(
      desc(target.ready_at),
      citations.target_handle,
      citations.target_slug,
    )
  return citedDeckSchema.array().parse(rows)
}

/** How many cited pages the owner's page lists. */
export const MAX_CITED_PAGES = 200

const deckLinkSchema = citedDeckSchema
  .pick({ handle: true, slug: true, title: true })
  .extend({ page: z.number().int() })
/** A public deck that links to a deck, and the page it names; 0 is the whole deck. */
export type DeckLink = Readonly<z.infer<typeof deckLinkSchema>>

/**
 * The pages of the given deck that public decks link to, one row for each
 * citing deck and page, for the owner's page.
 */
export async function readCitedPages(
  database: D1Database,
  handle: string,
  slug: string,
): Promise<DeckLink[]> {
  const rows = await drizzle(database)
    .select({
      handle: accounts.handle,
      slug: decks.id,
      title: deployments.title,
      page: citations.target_page,
    })
    .from(citations)
    .innerJoin(decks, eq(decks.public_deployment_id, citations.deployment_id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, citations.deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(
      and(
        eq(citations.target_handle, handle),
        eq(citations.target_slug, slug),
        isNull(decks.deleted_at),
      ),
    )
    .orderBy(asc(citations.target_page), accounts.handle, decks.id)
    .limit(MAX_CITED_PAGES)
  return deckLinkSchema.array().parse(rows)
}

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
  deckId: string,
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

/** Whether the owner has this deck and has not deleted it. */
export async function ownsDeck(
  database: D1Database,
  deckId: string,
  ownerUserId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(
        eq(decks.id, deckId),
        eq(decks.owner_user_id, ownerUserId),
        isNull(decks.deleted_at),
      ),
    )
    .get()
  return row !== undefined
}

/**
 * Adds posts under a deck and tells how many were new. A post already shown
 * keeps its page and source, and a full deck takes no more. The room is read
 * before the write, so two additions at once may pass the limit by one
 * addition's posts; only the deck's owner adds, so the trial accepts that.
 */
export async function addPosts(
  database: D1Database,
  deckId: string,
  posts: readonly Readonly<{
    post: Post
    page: number
    source: 'pasted' | 'collected'
    postedAt: number | null
  }>[],
  now: number,
): Promise<number> {
  const db = drizzle(database)
  const shown = await db.$count(
    reactionPosts,
    eq(reactionPosts.deck_id, deckId),
  )
  const [first, ...rest] = posts
    .slice(0, Math.max(0, MAX_POSTS - shown))
    .map((item) =>
      db
        .insert(reactionPosts)
        .values({
          id: crypto.randomUUID(),
          deck_id: deckId,
          page: item.page,
          service: item.post.service,
          post_key: postKey(item.post),
          post_url: postUrl(item.post),
          source: item.source,
          posted_at: item.postedAt,
          created_at: now,
        })
        .onConflictDoNothing(),
    )
  if (!first) return 0
  const results = await db.batch([first, ...rest])
  return results.reduce((sum, result) => sum + result.meta.changes, 0)
}

/** Removes one post from under a deck. */
export async function removePost(
  database: D1Database,
  deckId: string,
  id: string,
) {
  await drizzle(database)
    .delete(reactionPosts)
    .where(and(eq(reactionPosts.deck_id, deckId), eq(reactionPosts.id, id)))
}
