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

// A pause retries against newer states; anything else reports the change.
const MAX_PAUSE_ATTEMPTS = 3

type AuthorInput = Readonly<{
  deckId: string
  ownerUserId: string
  command: AuthorCommand
  expectedRevision: number
  now: number
}>

/** One read-decide-save attempt; `lost` means the save lost a race. */
async function attempt(
  database: D1Database,
  input: AuthorInput,
): Promise<AuthorResult | { kind: 'lost'; current: DeckPublication }> {
  const { deckId, ownerUserId, command, expectedRevision, now } = input
  const current = await readPublication(database, deckId, ownerUserId)
  if (!current) return { kind: 'not_found' }
  const decision = decideAuthor(current, command, expectedRevision)
  if (decision.kind !== 'apply')
    return { kind: decision.kind, publication: current }
  if (
    command.kind === 'publish' &&
    !(await isPublishable(database, deckId, command.deploymentId))
  )
    return { kind: 'not_publishable', publication: current }
  const { transition } = decision
  const saved = await saveTransition(database, {
    deckId,
    ownerUserId,
    from: current,
    transition,
    now,
  })
  return saved
    ? {
        kind: 'applied',
        publication: transition.next,
        revoke: transition.revoke,
      }
    : { kind: 'lost', current }
}

/**
 * Applies an author operation made against `expectedRevision`. A change by
 * anyone else in the meantime is reported as a conflict with the current
 * state, so the author can review it and choose again. A pause instead
 * stops whatever is current, including a publication that lands while it is
 * being saved.
 */
export async function applyAuthorCommand(
  database: D1Database,
  input: AuthorInput,
): Promise<AuthorResult> {
  const attempts = input.command.kind === 'pause' ? MAX_PAUSE_ATTEMPTS : 1
  for (let count = 1; ; count++) {
    const result = await attempt(database, input)
    if (result.kind !== 'lost') return result
    if (count < attempts) continue
    // The revision, the owner, or the target changed after it was read.
    const latest = await readPublication(
      database,
      input.deckId,
      input.ownerUserId,
    )
    if (!latest) return { kind: 'not_found' }
    return latest.revision === result.current.revision
      ? { kind: 'not_publishable', publication: latest }
      : { kind: 'conflict', publication: latest }
  }
}
