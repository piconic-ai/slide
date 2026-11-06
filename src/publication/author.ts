import type { DeckPublication } from './state'
import { isPublishable, readPublication, saveTransition } from './store'
import {
  decideAuthor,
  type AuthorCommand,
  type Revocation,
} from './transitions'

export type AuthorResult =
  | Readonly<{
      kind: 'applied'
      publication: DeckPublication
      revoke: Revocation
    }>
  | Readonly<{ kind: 'unchanged'; publication: DeckPublication }>
  | Readonly<{ kind: 'conflict'; publication: DeckPublication }>
  | Readonly<{ kind: 'not_paused'; publication: DeckPublication }>
  | Readonly<{ kind: 'not_publishable'; publication: DeckPublication }>
  | Readonly<{ kind: 'not_found' }>

/**
 * Applies an author operation made against `expectedRevision`. A change by
 * anyone else in the meantime is reported as a conflict with the current
 * state, so the author can review it and choose again.
 */
export async function applyAuthorCommand(
  database: D1Database,
  input: Readonly<{
    deckId: string
    ownerUserId: string
    command: AuthorCommand
    expectedRevision: number
    now: number
  }>,
): Promise<AuthorResult> {
  const { deckId, ownerUserId, command, expectedRevision, now } = input
  const current = await readPublication(database, deckId, ownerUserId)
  if (!current) return { kind: 'not_found' }
  if (
    command.kind === 'publish' &&
    !(await isPublishable(database, deckId, command.deploymentId))
  )
    return { kind: 'not_publishable', publication: current }
  const decision = decideAuthor(current, command, expectedRevision)
  if (decision.kind !== 'apply')
    return { kind: decision.kind, publication: current }
  const { transition } = decision
  if (
    await saveTransition(database, { deckId, from: current, transition, now })
  )
    return {
      kind: 'applied',
      publication: transition.next,
      revoke: transition.revoke,
    }
  // The revision or the target changed after it was read.
  const latest = await readPublication(database, deckId, ownerUserId)
  if (!latest) return { kind: 'not_found' }
  return latest.revision === current.revision
    ? { kind: 'not_publishable', publication: latest }
    : { kind: 'conflict', publication: latest }
}
