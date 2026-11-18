import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { deckSlugSchema } from '../decks/binding'
import { accounts, decks, suspensionRowSchema, suspensions } from '../db/schema'
import type { Suspension } from '../publication/suspension'
import type { Handle } from '../share/handle'
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
  /** The key, for releasing. */
  deckId: string
  /** The name in the share URL. */
  slug: string
  handle: string
  takedown: Takedown
}>

const rowSchema = z.object({
  deckId: z.string(),
  slug: deckSlugSchema,
  handle: z.string(),
})

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
    .select({
      deckId: decks.id,
      slug: decks.slug,
      handle: accounts.handle,
      ...takedownFields,
    })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(hiddenNow)
    .orderBy(desc(decks.hidden_at), decks.slug)
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
        eq(decks.slug, target.slug),
        eq(accounts.handle, target.handle),
        isNull(decks.deleted_at),
      ),
    )
    .get()
  return row?.id ?? null
}

export async function findAccount(
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

export type SuspendedAccount = Readonly<{
  userId: string
  handle: string | null
  suspension: Suspension
}>

const suspendedAccountRowSchema = suspensionRowSchema.extend({
  handle: z.string().nullable(),
})

/** Includes deleted accounts, whose suspension survives account deletion. */
export async function listSuspendedAccounts(
  database: D1Database,
): Promise<SuspendedAccount[]> {
  const rows = await drizzle(database)
    .select({
      user_id: suspensions.user_id,
      handle: accounts.handle,
      reason: suspensions.reason,
      suspended_at: suspensions.suspended_at,
      suspended_by: suspensions.suspended_by,
    })
    .from(suspensions)
    .leftJoin(accounts, eq(accounts.user_id, suspensions.user_id))
    .orderBy(desc(suspensions.suspended_at), suspensions.user_id)
    .limit(50)
  return rows.map((input) => {
    const row = suspendedAccountRowSchema.parse(input)
    return {
      userId: row.user_id,
      handle: row.handle,
      suspension: {
        suspendedAt: row.suspended_at,
        reason: row.reason,
        operator: row.suspended_by,
      },
    }
  })
}
