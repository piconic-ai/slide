import { z } from 'zod'
import { OPERATOR_MAX, takedownReasonSchema } from './takedown'

export type Suspension = Readonly<{
  suspendedAt: number
  reason: string
  operator: string
}>

export type SuspensionCommand =
  | Readonly<{ kind: 'suspend'; reason: string; operator: string }>
  | Readonly<{ kind: 'release' }>

export type SuspensionDecision =
  | Readonly<{ kind: 'apply'; next: Suspension | null }>
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'invalid_reason' }>
  | Readonly<{ kind: 'invalid_operator' }>

const operatorSchema = z.string().min(1).max(OPERATOR_MAX)

/** Repeated suspensions keep the first reason, time, and operator. */
export function decideSuspension(
  current: Suspension | null,
  command: SuspensionCommand,
  now: number,
): SuspensionDecision {
  if (command.kind === 'release')
    return current ? { kind: 'apply', next: null } : { kind: 'unchanged' }
  const reason = takedownReasonSchema.safeParse(command.reason)
  if (!reason.success) return { kind: 'invalid_reason' }
  if (!operatorSchema.safeParse(command.operator).success)
    return { kind: 'invalid_operator' }
  if (current) return { kind: 'unchanged' }
  return {
    kind: 'apply',
    next: { suspendedAt: now, reason: reason.data, operator: command.operator },
  }
}
