import {
  and,
  countDistinct,
  desc,
  eq,
  isNull,
  like,
  not,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  articleCitations,
  articles,
  citations,
  decks,
  deployments,
  uploadFiles,
} from '../db/schema'
import { deckSlugSchema, type DeckSlug } from '../decks/deck-id'
import { notBlockedBy } from '../blocks/store'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import type { Citation } from './citation'
import { readCitedCounts } from './pair-store'
import { DECKS_SHOWN } from './citing'

/** How many HTML files of one deployment are read for links. */
export const MAX_SCANNED_FILES = 200

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
    .select({ handle: accounts.handle, slug: decks.slug })
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
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  deploymentId: z.string(),
  /** The image file the deck names as its cover, from the deck's root. */
  coverPath: z.string().nullable(),
  /** When the deployment readers see became ready. */
  at: z.number().int(),
})
/** A public deck on one side of a citation, and the deployment readers see. */
export type CitedDeck = Readonly<z.infer<typeof citedDeckSchema>>

/**
 * The public decks whose current public deployment links to the given deck,
 * each once however many of its pages are linked, the most recently
 * published first, and how many there are in all. A deck stops counting when
 * its author unpublishes it or publishes a version without the link; a deck
 * whose article links to it counts while the article is published. A link
 * a deck makes to itself is no citation, whenever it got its names.
 */
export async function readCitedBy(
  database: D1Database,
  handle: string,
  slug: DeckSlug,
  /** How many decks to give; null gives them all. */
  limit: number | null,
  viewer: string | null,
): Promise<{ decks: CitedDeck[]; total: number }> {
  const db = drizzle(database)
  // A deck cites the target when its public version links to it, or when its
  // article is published and links to it.
  const links = or(
    sql`EXISTS (SELECT 1 FROM ${citations}
      WHERE ${citations.deployment_id} = ${deployments.id}
        AND ${citations.target_handle} = ${handle}
        AND ${citations.target_slug} = ${slug})`,
    sql`EXISTS (SELECT 1 FROM ${articleCitations}
      INNER JOIN ${articles} ON ${articles.deck_id} = ${articleCitations.deck_id}
      WHERE ${articleCitations.deck_id} = ${decks.id}
        AND ${articles.status} = 'published'
        AND ${articleCitations.target_handle} = ${handle}
        AND ${articleCitations.target_slug} = ${slug})`,
  )
  const citing = (fields: Parameters<typeof db.selectDistinct>[0]) =>
    db
      .selectDistinct(fields)
      .from(decks)
      .innerJoin(
        deployments,
        and(
          eq(deployments.id, decks.public_deployment_id),
          eq(deployments.deck_id, decks.id),
          eq(deployments.state, 'ready'),
        ),
      )
      .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
      .where(
        and(
          links,
          not(and(eq(accounts.handle, handle), eq(decks.slug, slug))!),
          isNull(decks.deleted_at),
          notHidden,
          notMutedBy(viewer),
          notBlockedBy(viewer),
        ),
      )
  const newestFirst = citing({
    handle: accounts.handle,
    slug: decks.slug,
    title: deployments.title,
    deploymentId: deployments.id,
    coverPath: deployments.cover_path,
    at: deployments.ready_at,
  }).orderBy(desc(deployments.ready_at), accounts.handle, decks.slug)
  const [rows, counted] = await Promise.all([
    limit === null ? newestFirst : newestFirst.limit(limit),
    citing({ total: countDistinct(decks.id) }),
  ])
  return {
    decks: citedDeckSchema.array().parse(rows),
    total: z.object({ total: z.number().int() }).parse(counted[0]).total,
  }
}

/**
 * The decks a deck links to that are public now, through the given version's
 * HTML or its article while that is published, each once however many of
 * its pages are linked and wherever, the most recently published first.
 * Links to drafts, paused or unknown decks are left out, so the list never
 * tells that such a deck exists. So is a link to the deck itself.
 */
export async function readCites(
  database: D1Database,
  deck: Readonly<{ deckId: string; deploymentId: string }>,
  viewer: string | null,
): Promise<CitedDeck[]> {
  const target = alias(deployments, 'target')
  // Where the deck links to others: the version readers see, and the article
  // while it is published. An article belongs to the deck, not to a version,
  // so its links stay when the public version is replaced.
  const links = sql`(
    SELECT c.target_handle, c.target_slug
    FROM ${citations} c
    WHERE c.deployment_id = ${deck.deploymentId}
    UNION
    SELECT ac.target_handle, ac.target_slug
    FROM ${articleCitations} ac
    INNER JOIN ${articles} a ON a.deck_id = ac.deck_id AND a.status = 'published'
    WHERE ac.deck_id = ${deck.deckId}
  ) AS cite_links`
  const rows = await drizzle(database)
    .selectDistinct({
      handle: accounts.handle,
      slug: decks.slug,
      title: target.title,
      deploymentId: target.id,
      coverPath: target.cover_path,
      at: target.ready_at,
    })
    .from(links)
    .innerJoin(accounts, eq(accounts.handle, sql`cite_links.target_handle`))
    .innerJoin(
      decks,
      and(
        eq(decks.owner_user_id, accounts.user_id),
        eq(decks.slug, sql`cite_links.target_slug`),
        not(eq(decks.id, deck.deckId)),
        notHidden,
        notMutedBy(viewer),
        notBlockedBy(viewer),
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
    .orderBy(desc(target.ready_at), accounts.handle, decks.slug)
  return citedDeckSchema.array().parse(rows)
}

/**
 * Both sides of the citations of the deck a share URL shows, for one reader:
 * the decks its public version and its published article cite, and the
 * latest few of the decks citing it with their count, and how many decks
 * cite each deck shown.
 */
export async function readViewerCitations(
  database: D1Database,
  deck: Readonly<{
    deckId: string
    deploymentId: string
    handle: string
    slug: DeckSlug
  }>,
  viewer: string | null,
) {
  const [cites, citedBy] = await Promise.all([
    readCites(database, deck, viewer),
    readCitedBy(database, deck.handle, deck.slug, DECKS_SHOWN, viewer),
  ])
  // The cards show how many decks cite each deck on them.
  const counts = await readCitedCounts(
    database,
    [...cites, ...citedBy.decks].map((shown) => shown.handle),
    viewer,
  )
  return { cites, citedBy, counts }
}
