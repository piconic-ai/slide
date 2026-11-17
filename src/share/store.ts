import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  deckIdSchema,
  deckSlugSchema,
  type DeckId,
  type DeckSlug,
} from '../decks/binding'
import { accounts, decks, deployments } from '../db/schema'
import { handleSchema, type Handle } from './handle'
import { notHidden } from '../publication/takedown-store'

/**
 * The deployment a share URL shows now: the deck's public deployment, still
 * ready and of the same deck. Drafts, paused and missing decks give null.
 */
export async function readSharedDeployment(
  database: D1Database,
  handle: Handle,
  slug: DeckSlug,
): Promise<{
  id: string
  /** The deck's key, for what is stored under it (posts, events). */
  deckId: DeckId
  title: string | null
  description: string | null
  coverPath: string | null
} | null> {
  const row = await drizzle(database)
    .select({
      id: deployments.id,
      deckId: decks.id,
      title: deployments.title,
      description: deployments.description,
      coverPath: deployments.cover_path,
    })
    .from(accounts)
    .innerJoin(
      decks,
      and(
        eq(decks.owner_user_id, accounts.user_id),
        eq(decks.slug, slug),
        notHidden,
      ),
    )
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(eq(accounts.handle, handle))
    .get()
  return row ? { ...row, deckId: deckIdSchema.parse(row.deckId) } : null
}

/** The handle of an owner, or null before their first sign-in records it. */
export async function readHandle(
  database: D1Database,
  userId: string,
): Promise<Handle | null> {
  const row = await drizzle(database)
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .get()
  return (row?.handle as Handle | undefined) ?? null
}

/** The user an author's handle names, or null when nobody holds it. */
export async function readHandleOwner(
  database: D1Database,
  handle: Handle,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ userId: accounts.user_id })
    .from(accounts)
    .where(eq(accounts.handle, handle))
    .get()
  return row?.userId ?? null
}

const publicDeckSchema = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  readyAt: z.number().int(),
  /** The deployment readers see. */
  deploymentId: z.string(),
  /** The image file the deck names as its cover, from the deck's root. */
  coverPath: z.string().nullable(),
})
export type PublicDeck = Readonly<z.infer<typeof publicDeckSchema>>

/**
 * Public decks, the most recently uploaded public deployment first. It joins
 * the same pointer as readSharedDeployment, so a deck is listed exactly when
 * its share URL shows it. Given a handle, only that author's decks.
 */
export async function listPublicDecks(
  database: D1Database,
  { handle, limit }: { handle?: Handle; limit: number },
): Promise<PublicDeck[]> {
  const rows = await drizzle(database)
    .select({
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      readyAt: deployments.ready_at,
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
    })
    .from(accounts)
    .innerJoin(decks, and(eq(decks.owner_user_id, accounts.user_id), notHidden))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(handle === undefined ? undefined : eq(accounts.handle, handle))
    .orderBy(desc(deployments.ready_at), decks.slug)
    .limit(limit)
  return publicDeckSchema.array().parse(rows)
}

/** Whether the deployment is the one a share URL shows now. */
export async function isPublicDeployment(
  database: D1Database,
  deploymentId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: deployments.id })
    .from(decks)
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    // The join already ties the deployment to the deck's public pointer.
    .where(and(eq(deployments.id, deploymentId), notHidden))
    .get()
  return row !== undefined
}
