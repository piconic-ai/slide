import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import type { Deployment } from '../db/schema'
import { parseDeckPublication } from './state'
import { publicationFields, saveTransition } from './store'
import {
  decideCi,
  type CiPublication,
  type CiSkipReason,
  type Revocation,
} from './transitions'

export type CiResult =
  | Readonly<{ kind: 'applied'; revoke: Revocation }>
  | Readonly<{ kind: 'skipped'; reason: CiSkipReason | 'no_deck' }>

// Concurrent changes move the revision; each retry rereads and decides again.
const MAX_ATTEMPTS = 3

const runNumber = (value: string) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('Stored run ID is not a number')
  return number
}

/** The CI input for a ready deployment, from its stored row. */
export function ciPublicationOf(row: Deployment): CiPublication {
  return {
    deploymentId: row.id,
    startRevision: row.start_revision,
    intent: row.publish_intent,
    run: { runId: runNumber(row.run_id), attempt: runNumber(row.run_attempt) },
  }
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
    const stored = await drizzle(database)
      .select(publicationFields)
      .from(decks)
      .where(eq(decks.id, deckId))
      .get()
    if (!stored) throw new Error('Deployment deck is missing')
    const current = parseDeckPublication(stored)
    const decision = decideCi(current, ci)
    if (decision.kind === 'skip')
      return { kind: 'skipped', reason: decision.reason }
    const { transition } = decision
    if (
      await saveTransition(database, { deckId, from: current, transition, now })
    )
      return { kind: 'applied', revoke: transition.revoke }
    if (attempt >= MAX_ATTEMPTS)
      throw new Error('Publication kept changing; retry finalize')
  }
}
