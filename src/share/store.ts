import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { deckIdSchema, type DeckId } from '../decks/binding'
import { accounts, decks, deployments } from '../db/schema'
import { handleSchema, type Handle } from './handle'

/**
 * The deployment a share URL shows now: the deck's public deployment, still
 * ready and of the same deck. Drafts, paused and missing decks give null.
 */
export async function readSharedDeployment(
  database: D1Database,
  handle: Handle,
  slug: DeckId,
): Promise<{ id: string; title: string | null } | null> {
  const row = await drizzle(database)
    .select({ id: deployments.id, title: deployments.title })
    .from(accounts)
    .innerJoin(
      decks,
      and(eq(decks.owner_user_id, accounts.user_id), eq(decks.id, slug)),
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
  return row ?? null
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
  slug: deckIdSchema,
  title: z.string().nullable(),
  readyAt: z.number().int(),
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
      slug: decks.id,
      title: deployments.title,
      readyAt: deployments.ready_at,
    })
    .from(accounts)
    .innerJoin(decks, eq(decks.owner_user_id, accounts.user_id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(handle === undefined ? undefined : eq(accounts.handle, handle))
    .orderBy(desc(deployments.ready_at), decks.id)
    .limit(limit)
  return publicDeckSchema.array().parse(rows)
}
