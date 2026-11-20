import {
  and,
  countDistinct,
  desc,
  eq,
  isNull,
  like,
  not,
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
  uploadFiles,
} from '../db/schema'
import { deckSlugSchema, type DeckSlug } from '../decks/binding'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import type { Citation } from './citation'
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
 * its author unpublishes it or publishes a version without the link. A link
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
          not(and(eq(accounts.handle, handle), eq(decks.slug, slug))!),
          isNull(decks.deleted_at),
          notHidden,
          notMutedBy(viewer),
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
 * Every public deck that cites one of the author's own decks, newest first,
 * for the deck's own page. Nothing is cut, and the author's mutes do not
 * apply: this is the record of where their slides were used. Before the
 * author has a handle no link can name the deck.
 */
export async function readOwnCitedBy(
  database: D1Database,
  ownerUserId: string,
  slug: DeckSlug,
): Promise<CitedDeck[]> {
  const row = await drizzle(database)
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, ownerUserId))
    .get()
  if (!row) return []
  return (await readCitedBy(database, row.handle, slug, null, null)).decks
}

/**
 * The decks a deployment links to that are public now, each once however
 * many of its pages are linked, the most recently published first. Links to
 * drafts, paused or unknown decks are left out, so the list never tells that
 * such a deck exists. So is a link to the deployment's own deck.
 */
export async function readCites(
  database: D1Database,
  deploymentId: string,
  viewer: string | null,
): Promise<CitedDeck[]> {
  const target = alias(deployments, 'target')
  const rows = await drizzle(database)
    .selectDistinct({
      handle: citations.target_handle,
      slug: citations.target_slug,
      title: target.title,
      deploymentId: target.id,
      coverPath: target.cover_path,
      at: target.ready_at,
    })
    .from(citations)
    .innerJoin(accounts, eq(accounts.handle, citations.target_handle))
    .innerJoin(
      decks,
      and(
        eq(decks.owner_user_id, accounts.user_id),
        eq(decks.slug, citations.target_slug),
        // A deployment of no deck cites every deck it names.
        sql`${decks.id} IS NOT (SELECT ${deployments.deck_id} FROM ${deployments}
          WHERE ${deployments.id} = ${deploymentId})`,
        notHidden,
        notMutedBy(viewer),
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

/**
 * Both sides of the citations of the deck a share URL shows, for one reader:
 * the decks its public version cites, and the latest few of the decks citing
 * it with their count.
 */
export async function readViewerCitations(
  database: D1Database,
  deck: Readonly<{ deploymentId: string; handle: string; slug: DeckSlug }>,
  viewer: string | null,
) {
  const [cites, citedBy] = await Promise.all([
    readCites(database, deck.deploymentId, viewer),
    readCitedBy(database, deck.handle, deck.slug, DECKS_SHOWN, viewer),
  ])
  return { cites, citedBy }
}
