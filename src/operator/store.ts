import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { accounts, decks } from '../db/schema'
import { takedownFields } from '../publication/takedown-store'
import { parseTakedown, type Takedown } from '../publication/takedown'
import type { TakedownTarget } from './target'

/** How many hidden decks the operator page lists. */
export const MAX_LISTED = 200

export type HiddenDeck = Readonly<{
  deckId: string
  handle: string
  takedown: Takedown
}>

const rowSchema = z.object({ deckId: z.string(), handle: z.string() })

/** The decks hidden now, the most recently hidden first. */
export async function listHiddenDecks(
  database: D1Database,
): Promise<HiddenDeck[]> {
  const rows = await drizzle(database)
    .select({ deckId: decks.id, handle: accounts.handle, ...takedownFields })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(and(isNotNull(decks.hidden_at), isNull(decks.deleted_at)))
    .orderBy(desc(decks.hidden_at), decks.id)
    .limit(MAX_LISTED)
  return rows.flatMap((row) => {
    const takedown = parseTakedown(row)
    return takedown ? [{ ...rowSchema.parse(row), takedown }] : []
  })
}

/** The live deck a share URL names, whatever its publication; else null. */
export async function findDeck(
  database: D1Database,
  target: TakedownTarget,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ id: decks.id })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(
      and(
        eq(decks.id, target.slug),
        eq(accounts.handle, target.handle),
        isNull(decks.deleted_at),
      ),
    )
    .get()
  return row?.id ?? null
}
