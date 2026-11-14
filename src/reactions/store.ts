import { and, countDistinct, desc, eq, isNull, like, sql } from 'drizzle-orm'
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
import type { Citation } from './citation'

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
