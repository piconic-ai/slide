import { z } from 'zod'
import { deckRowSchema } from '../db/schema'

export const TAKEDOWN_REASON_MAX = 500

/**
 * An operator's decision to hide a deck from every reader, the author
 * included. It is independent of the author's publication: hiding leaves
 * the publication as it is, and releasing brings it back unchanged.
 */
export type Takedown = Readonly<{
  hiddenAt: number
  /** Shown to the author. */
  reason: string
  /** The operator's identity as the access provider verified it. */
  operator: string
}>

/** The stored takedown columns of a deck row. */
export const takedownRowSchema = deckRowSchema
  .pick({ hidden_at: true, hidden_reason: true, hidden_by: true })
  .refine(
    (row) =>
      (row.hidden_at === null) === (row.hidden_reason === null) &&
      (row.hidden_at === null) === (row.hidden_by === null),
    { message: 'Takedown columns must be stored together' },
  )

/** Parses stored columns into a takedown, or null for a deck not hidden. */
export function parseTakedown(input: unknown): Takedown | null {
  const row = takedownRowSchema.parse(input)
  if (
    row.hidden_at === null ||
    row.hidden_reason === null ||
    row.hidden_by === null
  )
    return null
  return {
    hiddenAt: row.hidden_at,
    reason: row.hidden_reason,
    operator: row.hidden_by,
  }
}

/** A reason as an operator typed it, trimmed; empty or too long is invalid. */
export const takedownReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(TAKEDOWN_REASON_MAX)

export type OperatorCommand =
  | Readonly<{ kind: 'hide'; reason: string; operator: string }>
  | Readonly<{ kind: 'release' }>

export type OperatorDecision =
  | Readonly<{ kind: 'apply'; next: Takedown | null }>
  /** The deck is already in the state the command asks for. */
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'invalid_reason' }>

/**
 * Decides an operator's command. Hiding a hidden deck keeps the first
 * reason, time, and operator, so the record shown to the author does not
 * change under them.
 */
export function decideOperator(
  current: Takedown | null,
  command: OperatorCommand,
  now: number,
): OperatorDecision {
  if (command.kind === 'release')
    return current ? { kind: 'apply', next: null } : { kind: 'unchanged' }
  const reason = takedownReasonSchema.safeParse(command.reason)
  if (!reason.success) return { kind: 'invalid_reason' }
  if (current) return { kind: 'unchanged' }
  return {
    kind: 'apply',
    next: { hiddenAt: now, reason: reason.data, operator: command.operator },
  }
}

/** The stored columns of a takedown, all null when the deck is not hidden. */
export function takedownColumns(takedown: Takedown | null) {
  return {
    hidden_at: takedown?.hiddenAt ?? null,
    hidden_reason: takedown?.reason ?? null,
    hidden_by: takedown?.operator ?? null,
  }
}

/** Author commands that would start or restore public delivery. */
export function blockedByTakedown(
  takedown: Takedown | null,
  commandKind: 'publish' | 'pause' | 'resume' | 'set_mode',
): boolean {
  return (
    takedown !== null && (commandKind === 'publish' || commandKind === 'resume')
  )
}
