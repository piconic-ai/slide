import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import { notSuspended } from './suspension-store'
import {
  decideOperator,
  parseTakedown,
  takedownColumns,
  type OperatorCommand,
  type Takedown,
} from './takedown'

/**
 * The condition that no operator has hidden the deck or suspended its owner.
 * Every query that shows a deck or its files to a reader carries it.
 */
export const notHidden = and(isNull(decks.hidden_at), notSuspended)

export const takedownFields = {
  hidden_at: decks.hidden_at,
  hidden_reason: decks.hidden_reason,
  hidden_by: decks.hidden_by,
}

/** A live deck's takedown; `missing` for unknown or deleted decks. */
export async function readTakedown(
  database: D1Database,
  deckId: string,
): Promise<Takedown | null | 'missing'> {
  const row = await drizzle(database)
    .select(takedownFields)
    .from(decks)
    .where(and(eq(decks.id, deckId), isNull(decks.deleted_at)))
    .get()
  return row ? parseTakedown(row) : 'missing'
}

export type OperatorResult =
  | Readonly<{ kind: 'applied'; takedown: Takedown | null }>
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'invalid_reason' }>
  | Readonly<{ kind: 'invalid_operator' }>
  | Readonly<{ kind: 'not_found' }>

/** The condition that the deck's stored takedown is exactly `takedown`. */
const takedownIs = (takedown: Takedown | null) =>
  takedown
    ? and(
        eq(decks.hidden_at, takedown.hiddenAt),
        eq(decks.hidden_reason, takedown.reason),
        eq(decks.hidden_by, takedown.operator),
      )
    : isNull(decks.hidden_at)

/**
 * Stores `next` only if the live deck's takedown is still `from`, the one
 * the decision was made from. A release decided against one takedown never
 * clears a later one. Returns false when nothing matched.
 */
export async function saveTakedown(
  database: D1Database,
  input: Readonly<{
    deckId: string
    from: Takedown | null
    next: Takedown | null
  }>,
): Promise<boolean> {
  const saved = await drizzle(database)
    .update(decks)
    .set(takedownColumns(input.next))
    .where(
      and(
        eq(decks.id, input.deckId),
        isNull(decks.deleted_at),
        takedownIs(input.from),
      ),
    )
    .returning({ id: decks.id })
    .all()
  return saved.length > 0
}

/**
 * Applies an operator's command to a live deck. Two operators hiding at
 * once store one takedown and the other sees it as unchanged.
 */
export async function applyOperatorCommand(
  database: D1Database,
  input: Readonly<{ deckId: string; command: OperatorCommand; now: number }>,
): Promise<OperatorResult> {
  const { deckId, command, now } = input
  const current = await readTakedown(database, deckId)
  if (current === 'missing') return { kind: 'not_found' }
  const decision = decideOperator(current, command, now)
  if (decision.kind !== 'apply') return decision
  const { next } = decision
  if (await saveTakedown(database, { deckId, from: current, next }))
    return { kind: 'applied', takedown: next }
  // Lost to a concurrent command or a deletion; the stored state stands.
  const latest = await readTakedown(database, deckId)
  return latest === 'missing' ? { kind: 'not_found' } : { kind: 'unchanged' }
}
