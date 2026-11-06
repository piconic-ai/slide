import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import type { Deployment } from '../db/schema'
import {
  compareCiRuns,
  parseDeckPublication,
  type DeckPublication,
} from './state'
import { publicationFields, saveTransition } from './store'
import {
  decideCi,
  type CiPublication,
  type CiSkipReason,
  type Revocation,
} from './transitions'

export type CiResult =
  | Readonly<{ kind: 'applied'; revoke: Revocation }>
  /** A resend of the run whose result is the current publication. */
  | Readonly<{ kind: 'already_applied' }>
  | Readonly<{
      kind: 'skipped'
      reason: CiSkipReason | 'no_deck' | 'deck_deleted'
    }>

// Concurrent changes move the revision; each retry rereads and decides again.
const MAX_ATTEMPTS = 3

const runNumber = (value: string, minimum: number) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum)
    throw new Error('Stored run ID or attempt is out of range')
  return number
}

/** The CI input for a ready deployment, from its stored row. */
export function ciPublicationOf(row: Deployment): CiPublication {
  return {
    deploymentId: row.id,
    startRevision: row.start_revision,
    intent: row.publish_intent,
    run: {
      runId: runNumber(row.run_id, 0),
      attempt: runNumber(row.run_attempt, 1),
    },
  }
}

/**
 * Whether the deck shows this run's own result, so a resent finalize whose
 * first response was lost still reports that it applied.
 */
function isCurrentResult(deck: DeckPublication, ci: CiPublication) {
  if (!deck.lastCiRun || compareCiRuns(deck.lastCiRun, ci.run) !== 0)
    return false
  const { publication } = deck
  return ci.intent === 'published'
    ? publication.kind === 'public' &&
        publication.deploymentId === ci.deploymentId
    : publication.kind !== 'public'
}

async function readLivePublication(
  database: D1Database,
  deckId: string,
): Promise<DeckPublication | 'deleted'> {
  const stored = await drizzle(database)
    .select({ ...publicationFields, deletedAt: decks.deleted_at })
    .from(decks)
    .where(eq(decks.id, deckId))
    .get()
  if (!stored) throw new Error('Deployment deck is missing')
  return stored.deletedAt === null ? parseDeckPublication(stored) : 'deleted'
}

/**
 * Applies the publication a ready deployment's workflow asked for, when the
 * deck is in repository mode and nothing newer outranks it. Safe to repeat:
 * a recorded run is skipped.
 */
export async function applyCiPublication(
  database: D1Database,
  row: Deployment,
  now: number,
): Promise<CiResult> {
  if (row.state !== 'ready')
    throw new Error('Only a ready deployment can be published')
  // Uploads from before decks existed have nothing to publish to.
  if (row.deck_id === null) return { kind: 'skipped', reason: 'no_deck' }
  const deckId = row.deck_id
  const ci = ciPublicationOf(row)
  for (let attempt = 1; ; attempt++) {
    const current = await readLivePublication(database, deckId)
    // A deck deleted while the upload finished publishes nothing.
    if (current === 'deleted')
      return { kind: 'skipped', reason: 'deck_deleted' }
    const decision = decideCi(current, ci)
    if (decision.kind === 'skip')
      return decision.reason === 'recorded_run' && isCurrentResult(current, ci)
        ? { kind: 'already_applied' }
        : { kind: 'skipped', reason: decision.reason }
    const { transition } = decision
    if (
      await saveTransition(database, { deckId, from: current, transition, now })
    )
      return { kind: 'applied', revoke: transition.revoke }
    if (attempt >= MAX_ATTEMPTS)
      throw new Error('Publication kept changing; retry finalize')
  }
}
