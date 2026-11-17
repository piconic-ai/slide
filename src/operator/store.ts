import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { accounts, decks } from '../db/schema'
import { takedownFields } from '../publication/takedown-store'
import { parseTakedown, type Takedown } from '../publication/takedown'
import type { TakedownTarget } from './target'

/** How many hidden decks one page of the operator's list shows. */
export const PAGE_SIZE = 50

/** A page number from a query, counted from 1; anything else is page 1. */
export function parsePage(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]{0,5}$/.test(value)) return 1
  return Number(value)
}

export type HiddenPage = Readonly<{
  hidden: HiddenDeck[]
  /** Every deck hidden now, on all pages. */
  total: number
  /** The page shown, pulled back to the last one that exists. */
  page: number
  pages: number
}>

export type HiddenDeck = Readonly<{
  deckId: string
  handle: string
  takedown: Takedown
}>

const rowSchema = z.object({ deckId: z.string(), handle: z.string() })

/**
 * One page of the decks hidden now, the most recently hidden first. Every
 * hidden deck is on some page, so each can be read and released.
 */
export async function listHiddenDecks(
  database: D1Database,
  requestedPage: number,
): Promise<HiddenPage> {
  const db = drizzle(database)
  const hiddenNow = and(isNotNull(decks.hidden_at), isNull(decks.deleted_at))
  const counted = await db
    .select({ total: count() })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(hiddenNow)
    .get()
  const total = counted?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(requestedPage, pages)
  const rows = await db
    .select({ deckId: decks.id, handle: accounts.handle, ...takedownFields })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(hiddenNow)
    .orderBy(desc(decks.hidden_at), decks.id)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
  const hidden = rows.flatMap((row) => {
    const takedown = parseTakedown(row)
    return takedown ? [{ ...rowSchema.parse(row), takedown }] : []
  })
  return { hidden, total, page, pages }
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
