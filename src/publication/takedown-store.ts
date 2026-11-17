import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import {
  decideOperator,
  parseTakedown,
  takedownColumns,
  type OperatorCommand,
  type Takedown,
} from './takedown'

/**
 * The condition that no operator has hidden the deck. Every query that
 * shows a deck or its files to a reader carries it.
 */
export const notHidden = isNull(decks.hidden_at)

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
  | Readonly<{ kind: 'not_found' }>

/**
 * Applies an operator's command to a live deck. The save only matches the
 * state the decision was made from, so two operators hiding at once store
 * one takedown and the other sees it as unchanged.
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
  const saved = await drizzle(database)
    .update(decks)
    .set(takedownColumns(decision.next))
    .where(
      and(
        eq(decks.id, deckId),
        isNull(decks.deleted_at),
        decision.next ? isNull(decks.hidden_at) : isNotNull(decks.hidden_at),
      ),
    )
    .returning({ id: decks.id })
    .all()
  if (saved.length > 0) return { kind: 'applied', takedown: decision.next }
  // Lost to a concurrent command or a deletion; report what is stored now.
  const latest = await readTakedown(database, deckId)
  return latest === 'missing' ? { kind: 'not_found' } : { kind: 'unchanged' }
}
