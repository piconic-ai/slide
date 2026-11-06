import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { DeckId } from '../decks/binding'
import { accounts, decks, deployments } from '../db/schema'
import type { Handle } from './handle'

/**
 * The deployment a share URL shows now: the deck's public deployment, still
 * ready and of the same deck. Drafts, paused and missing decks give null.
 */
export async function readSharedDeployment(
  database: D1Database,
  handle: Handle,
  slug: DeckId,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ id: deployments.id })
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
  return row?.id ?? null
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
